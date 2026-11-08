import { Inject, Injectable, Logger, OnModuleInit, UnauthorizedException, ConflictException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { eq } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import type { Role } from "@aiwb/shared";
import { DB, type Db } from "../db/db.module";
import { users, sessions } from "../db/schema";
import { hashPassword, verifyPassword } from "./password";

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  profile: Record<string, unknown> | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

const REFRESH_TTL_MS = 7 * 24 * 3600 * 1000;

/** 默认管理员账号（首次启动自动创建，可通过环境变量覆盖） */
const DEFAULT_ADMIN_USER = process.env.ADMIN_USER ?? "admin";
const DEFAULT_ADMIN_PASS = process.env.ADMIN_PASS ?? "admin";

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly log = new Logger("auth");

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jwt: JwtService,
  ) {}

  async onModuleInit() {
    await this.ensureAdmin();
  }

  /** 确保至少有一个 owner，且 admin 账号可用。幂等，重复启动无害。 */
  private async ensureAdmin() {
    const [adminUser] = await this.db
      .select()
      .from(users)
      .where(eq(users.username, DEFAULT_ADMIN_USER));

    if (adminUser) {
      // admin 存在但角色不是 owner → 升级
      if (adminUser.role !== "owner") {
        await this.db
          .update(users)
          .set({ role: "owner" })
          .where(eq(users.id, adminUser.id));
        this.log.log(`▸ admin 用户「${DEFAULT_ADMIN_USER}」角色已升级为 owner`);
      }
      // 种子管理员（seeded）的密码以 ADMIN_PASS 环境变量为单一来源，每次启动同步
      // —— 这样与 MinIO root 共用同一套凭据，改一处即全局生效
      const profile = (adminUser.profileJson ?? {}) as { seeded?: boolean };
      if (profile.seeded) {
        const expectedHash = hashPassword(DEFAULT_ADMIN_PASS);
        if (expectedHash !== adminUser.passwordHash) {
          await this.db
            .update(users)
            .set({ passwordHash: expectedHash })
            .where(eq(users.id, adminUser.id));
          this.log.log(`▸ 种子管理员密码已同步为 ADMIN_PASS`);
        }
      }
      return;
    }

    // admin 不存在 → 创建
    await this.db.insert(users).values({
      id: randomUUID(),
      username: DEFAULT_ADMIN_USER,
      passwordHash: hashPassword(DEFAULT_ADMIN_PASS),
      role: "owner",
      profileJson: { seeded: true, note: "default admin" },
      createdAt: new Date(),
    });
    this.log.log(`▸ 已创建默认管理员 ${DEFAULT_ADMIN_USER} / ${DEFAULT_ADMIN_PASS}（请及时修改密码）`);
  }

  toPublic(u: typeof users.$inferSelect): PublicUser {
    return { id: u.id, username: u.username, role: u.role, profile: u.profileJson };
  }

  async register(username: string, password: string) {
    const exist = await this.db.select().from(users).where(eq(users.username, username));
    if (exist.length > 0) throw new ConflictException("username taken");
    // 第一个注册用户即 owner，其后为 member；guest 为未登录访客角色，不落库
    const all = await this.db.select({ id: users.id }).from(users);
    const role: Role = all.length === 0 ? "owner" : "member";
    const row: typeof users.$inferSelect = {
      id: randomUUID(),
      username,
      passwordHash: hashPassword(password),
      role,
      profileJson: null,
      createdAt: new Date(),
    };
    await this.db.insert(users).values(row);
    return { user: this.toPublic(row), tokens: await this.issueTokens(row) };
  }

  async login(username: string, password: string) {
    const [u] = await this.db.select().from(users).where(eq(users.username, username));
    if (!u || !verifyPassword(password, u.passwordHash)) {
      throw new UnauthorizedException("invalid credentials");
    }
    return { user: this.toPublic(u), tokens: await this.issueTokens(u) };
  }

  async refresh(refreshToken: string) {
    const [s] = await this.db.select().from(sessions).where(eq(sessions.refreshToken, refreshToken));
    if (!s || s.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("refresh token expired");
    }
    const [u] = await this.db.select().from(users).where(eq(users.id, s.userId));
    if (!u) throw new UnauthorizedException("user gone");
    await this.db.delete(sessions).where(eq(sessions.id, s.id)); // 旋转
    return { user: this.toPublic(u), tokens: await this.issueTokens(u) };
  }

  async logout(refreshToken: string) {
    await this.db.delete(sessions).where(eq(sessions.refreshToken, refreshToken));
  }

  private async issueTokens(u: typeof users.$inferSelect): Promise<AuthTokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: u.id, username: u.username, role: u.role },
      { expiresIn: "15m" },
    );
    const refreshToken = randomBytes(48).toString("hex");
    await this.db.insert(sessions).values({
      id: randomUUID(),
      userId: u.id,
      refreshToken,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    });
    return { accessToken, refreshToken };
  }
}
