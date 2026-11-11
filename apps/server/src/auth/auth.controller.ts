import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { JwtAuthGuard, CurrentUser, type AuthUser } from "./jwt-auth.guard";
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from "./refresh-cookie";

/** 只声明用到的响应/请求字段，避免引入 @types/express */
interface CookieResponse {
  cookie: (name: string, value: string, opts: Record<string, unknown>) => unknown;
  clearCookie: (name: string, opts: Record<string, unknown>) => unknown;
}
interface CookieRequest {
  headers: { cookie?: string };
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** 发送注册验证码（邮箱） */
  @Post("code")
  @HttpCode(200)
  sendCode(@Body() body: { email?: string }) {
    return this.auth.sendRegisterCode(body?.email ?? "");
  }

  /**
   * 邮箱 + 密码 + 验证码注册；账号与昵称由服务端生成。
   * refresh token 同时写入 httpOnly Cookie，浏览器刷新后仍保持登录。
   */
  @Post("register")
  async register(
    @Body() body: { email?: string; password?: string; code?: string },
    @Res({ passthrough: true }) res: CookieResponse,
  ) {
    const { email = "", password = "", code = "" } = body ?? {};
    if (!email.trim()) throw new BadRequestException("请填写邮箱");
    // 与 MinIO root 密码规则对齐（MINIO_ROOT_PASSWORD 至少 8 位），
    // 网站管理员账号同时作为 MinIO root，规则统一避免「网站能建、对象存储起不来」
    if (password.length < 8) throw new BadRequestException("password 至少 8 位（与 MinIO root 密码规则一致）");
    if (!code.trim()) throw new BadRequestException("请填写邮箱验证码");
    const result = await this.auth.register({ email, password, code });
    setRefreshCookie(res, result.tokens.refreshToken);
    return result;
  }

  /** 登录：账号名或邮箱 + 密码（admin 用配置账号直接登录） */
  @Post("login")
  @HttpCode(200)
  async login(
    @Body() body: { username?: string; password?: string },
    @Res({ passthrough: true }) res: CookieResponse,
  ) {
    const result = await this.auth.login(body?.username ?? "", body?.password ?? "");
    setRefreshCookie(res, result.tokens.refreshToken);
    return result;
  }

  /**
   * 换票：优先用 Cookie；CLI 等非浏览器客户端仍可在 body 里传 refreshToken。
   * 每次刷新都旋转 refresh token 并重写 Cookie（滑动 7 天）。
   */
  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @Body() body: { refreshToken?: string },
    @Req() req: CookieRequest,
    @Res({ passthrough: true }) res: CookieResponse,
  ) {
    const token = body?.refreshToken?.trim() || readRefreshCookie(req);
    if (!token) throw new BadRequestException("缺少 refresh token");
    const result = await this.auth.refresh(token);
    setRefreshCookie(res, result.tokens.refreshToken);
    return result;
  }

  @Post("logout")
  @HttpCode(200)
  async logout(
    @Body() body: { refreshToken?: string },
    @Req() req: CookieRequest,
    @Res({ passthrough: true }) res: CookieResponse,
  ) {
    const token = body?.refreshToken?.trim() || readRefreshCookie(req);
    if (token) await this.auth.logout(token);
    clearRefreshCookie(res);
    return { ok: true };
  }

  /** 当前用户（含 email / nickname，昵称改动后刷新即可见） */
  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.selfId);
  }

  /** 修改昵称（header 里唯一允许用户自己改的字段） */
  @Patch("me")
  @UseGuards(JwtAuthGuard)
  updateMe(@CurrentUser() user: AuthUser, @Body() body: { nickname?: string }) {
    return this.auth.updateNickname(user.selfId, body?.nickname ?? "");
  }
}
