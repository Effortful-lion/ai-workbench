import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException,
  createParamDecorator,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Role } from "@aiwb/shared";
import { WorkspaceOwner } from "../common/workspace-owner";

export interface AuthUser {
  /** 数据归属 id：非 owner 用户读内容时指向站点主人 admin */
  id: string;
  /** 真实登录用户 id：个人数据（会话/站内信/昵称/评论身份）用它 */
  selfId: string;
  username: string;
  role: Role;
}

/**
 * 个人数据前缀：这些模块必须按「登录人自己」处理，不能被映射到站点主人。
 * - auth：改昵称、查自己
 * - notify：站内信是发给具体某个人的
 * - chat：会话记录属于对话者本人，混进 admin 的列表会造成串号
 * - tools：自定义工具含请求头密钥，只认创建者
 * - blog/public：公开页发评论，身份必须是评论人自己
 */
const PERSONAL_PREFIXES = ["/auth", "/notify", "/chat", "/tools", "/blog/public"];

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly owner: WorkspaceOwner,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token: string | undefined = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) throw new UnauthorizedException("missing token");
    let payload: { sub: string; username: string; role: Role };
    try {
      payload = await this.jwt.verifyAsync<{ sub: string; username: string; role: Role }>(token);
    } catch {
      throw new UnauthorizedException("invalid token");
    }
    // 展示型内容统一读 admin 的数据；个人数据仍走登录人自己
    let dataId = payload.sub;
    if (payload.role !== "owner" && this.isSharedContent(req)) {
      dataId = await this.owner.id();
    }
    req.user = {
      id: dataId,
      selfId: payload.sub,
      username: payload.username,
      role: payload.role,
    } satisfies AuthUser;
    return true;
  }

  private isSharedContent(req: { originalUrl?: string; url?: string }): boolean {
    const raw = (req.originalUrl ?? req.url ?? "").split("?")[0];
    const path = raw.startsWith("/api") ? raw.slice(4) : raw;
    return !PERSONAL_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
