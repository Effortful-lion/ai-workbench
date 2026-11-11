import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { and, desc, eq, isNull } from "drizzle-orm";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { AuthUserDto, Role, SendCodeResult } from "@aiwb/shared";
import { DB, type Db } from "../db/db.module";
import { users, sessions, emailCodes } from "../db/schema";
import { MailerService } from "../common/mailer.service";
import { hashPassword, verifyPassword } from "./password";

/** 对外用户信息：共享类型 + 仅服务端使用的 profile */
export interface PublicUser extends AuthUserDto {
  profile: Record<string, unknown> | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

const REFRESH_TTL_MS = 7 * 24 * 3600 * 1000;

/** 验证码：10 分钟有效、60 秒内不重发、错 5 次作废 */
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_RESEND_MS = 60 * 1000;
const CODE_MAX_ATTEMPTS = 5;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** 默认管理员账号（首次启动自动创建，可通过环境变量覆盖） */
const DEFAULT_ADMIN_USER = process.env.ADMIN_USER ?? "admin";
const DEFAULT_ADMIN_PASS = process.env.ADMIN_PASS ?? "admin";

/** 昵称词库：形容词 × 名词组合出「安静的海獭」这类默认昵称 */
const NICK_ADJ = [
  "安静的", "明亮的", "奔跑的", "沉默的", "轻盈的", "深夜的", "清晨的", "远行的", "从容的", "好奇的",
  "迟钝的", "雪白的", "慢热的", "清醒的", "打盹的",
];
const NICK_NOUN = [
  "海獭", "灯塔", "齿轮", "纸鸢", "山雀", "水母", "沙丘", "卫星", "苔藓", "陀螺",
  "琥珀", "季风", "铅笔", "橡树", "罗盘",
];

function normalizeEmail(raw: string): string {
  const email = (raw ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new BadRequestException("邮箱格式不正确");
  if (email.length > 120) throw new BadRequestException("邮箱过长");
  return email;
}

/** 邮箱前缀 → 账号句柄（公开页路径用），非法字符剔除，过短补前缀 */
function baseUsername(email: string): string {
  const local = email.split("@")[0].replace(/[^a-z0-9_-]/g, "").slice(0, 20);
  return local.length >= 2 ? local : `user${local}`;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly log = new Logger("auth");

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly mailer: MailerService,
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

    // admin 不存在 → 创建（配置账号是唯一不走邮箱注册的账号）
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
    return {
      id: u.id,
      username: u.username,
      email: u.email ?? null,
      nickname: u.nickname ?? u.username,
      role: u.role,
      profile: u.profileJson,
    };
  }

  /** 发送注册验证码：同邮箱 60 秒冷却，旧码立即作废 */
  async sendRegisterCode(rawEmail: string): Promise<SendCodeResult> {
    const email = normalizeEmail(rawEmail);
    const [exist] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (exist) throw new ConflictException("该邮箱已注册，请直接登录");

    const [recent] = await this.db
      .select()
      .from(emailCodes)
      .where(and(eq(emailCodes.email, email), eq(emailCodes.purpose, "register")))
      .orderBy(desc(emailCodes.createdAt))
      .limit(1);
    if (recent) {
      const wait = CODE_RESEND_MS - (Date.now() - recent.createdAt.getTime());
      if (wait > 0) throw new BadRequestException(`验证码已发送，请 ${Math.ceil(wait / 1000)} 秒后再试`);
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const now = new Date();
    await this.db
      .update(emailCodes)
      .set({ consumedAt: now })
      .where(
        and(
          eq(emailCodes.email, email),
          eq(emailCodes.purpose, "register"),
          isNull(emailCodes.consumedAt),
        ),
      );
    await this.db.insert(emailCodes).values({
      id: randomUUID(),
      email,
      code,
      purpose: "register",
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      attempts: 0,
      createdAt: now,
    });

    const ttl = Math.floor(CODE_TTL_MS / 1000);
    const sent = await this.mailer.send(
      email,
      "AI-Workbench 注册验证码",
      [
        `你的注册验证码：${code}`,
        "",
        `${Math.floor(ttl / 60)} 分钟内有效，仅可使用一次。`,
        "如非本人操作，请忽略本邮件。",
      ].join("\n"),
    );

    if (!sent) {
      this.log.warn(`▸ SMTP 未配置，验证码仅打印到服务端日志：${email} → ${code}`);
      return { sent: false, ttl, devCode: code };
    }
    return { sent: true, ttl };
  }

  /** 邮箱 + 密码 + 验证码注册；账号与昵称自动生成 */
  async register(input: { email?: string; password?: string; code?: string }) {
    const email = normalizeEmail(input.email ?? "");
    const password = input.password ?? "";
    const code = (input.code ?? "").trim();
    if (password.length < 8) throw new BadRequestException("password 至少 8 位（与 MinIO root 密码规则一致）");
    if (!code) throw new BadRequestException("请填写邮箱验证码");

    const [dup] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (dup) throw new ConflictException("该邮箱已注册，请直接登录");

    await this.consumeCode(email, code);

    const username = await this.uniqueUsername(baseUsername(email));
    const nickname = await this.uniqueNickname();
    // 库里没有 owner 时才给出 owner（正常情况 admin 已在启动时种入）
    const all = await this.db.select({ id: users.id }).from(users);
    const role: Role = all.length === 0 ? "owner" : "member";

    const id = randomUUID();
    await this.db.insert(users).values({
      id,
      username,
      email,
      nickname,
      passwordHash: hashPassword(password),
      role,
      profileJson: null,
      createdAt: new Date(),
    });
    const [u] = await this.db.select().from(users).where(eq(users.id, id));
    this.log.log(`▸ 新用户注册：${email} → @${username}（${nickname}）`);
    return { user: this.toPublic(u), tokens: await this.issueTokens(u) };
  }

  /** 校验并消费验证码；错误计数用于防爆破 */
  private async consumeCode(email: string, code: string) {
    const [row] = await this.db
      .select()
      .from(emailCodes)
      .where(
        and(
          eq(emailCodes.email, email),
          eq(emailCodes.purpose, "register"),
          isNull(emailCodes.consumedAt),
        ),
      )
      .orderBy(desc(emailCodes.createdAt))
      .limit(1);
    if (!row) throw new BadRequestException("请先获取邮箱验证码");
    if (row.expiresAt.getTime() < Date.now()) throw new BadRequestException("验证码已过期，请重新获取");
    if (row.attempts >= CODE_MAX_ATTEMPTS) throw new BadRequestException("错误次数过多，请重新获取验证码");
    if (row.code !== code) {
      await this.db
        .update(emailCodes)
        .set({ attempts: row.attempts + 1 })
        .where(eq(emailCodes.id, row.id));
      throw new BadRequestException("验证码不正确");
    }
    await this.db.update(emailCodes).set({ consumedAt: new Date() }).where(eq(emailCodes.id, row.id));
  }

  private async uniqueUsername(base: string): Promise<string> {
    for (let i = 1; i <= 50; i += 1) {
      const candidate = i === 1 ? base : `${base}${i}`;
      const [row] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, candidate));
      if (!row) return candidate;
    }
    return `${base}${randomBytes(3).toString("hex")}`;
  }

  private async uniqueNickname(): Promise<string> {
    for (let i = 0; i < 12; i += 1) {
      const candidate = `${NICK_ADJ[randomInt(0, NICK_ADJ.length)]}${NICK_NOUN[randomInt(0, NICK_NOUN.length)]}`;
      const [row] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.nickname, candidate));
      if (!row) return candidate;
    }
    // 撞名概率极低，兜底加数字后缀
    return `${NICK_ADJ[randomInt(0, NICK_ADJ.length)]}${NICK_NOUN[randomInt(0, NICK_NOUN.length)]}${randomInt(10, 100)}`;
  }

  /** 登录：账号或邮箱均可，大小写不敏感（邮箱） */
  async login(identifier: string, password: string) {
    const key = (identifier ?? "").trim();
    if (!key || !password) throw new UnauthorizedException("invalid credentials");
    const [u] = await this.db
      .select()
      .from(users)
      .where(key.includes("@") ? eq(users.email, key.toLowerCase()) : eq(users.username, key));
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

  /** 当前用户（从库里取，保证昵称改动即时可见） */
  async me(userId: string): Promise<PublicUser> {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u) throw new UnauthorizedException("user gone");
    return this.toPublic(u);
  }

  /** 修改昵称：1–20 个字符，去首尾空白，禁控制字符 */
  async updateNickname(userId: string, raw: string): Promise<PublicUser> {
    const nickname = (raw ?? "").trim().replace(/\s+/g, " ");
    if (!nickname) throw new BadRequestException("昵称不能为空");
    if (Array.from(nickname).length > 20) throw new BadRequestException("昵称最多 20 个字符");
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(nickname)) throw new BadRequestException("昵称包含非法字符");
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u) throw new UnauthorizedException("user gone");
    await this.db.update(users).set({ nickname }).where(eq(users.id, userId));
    return { ...this.toPublic(u), nickname };
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
