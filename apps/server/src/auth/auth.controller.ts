import { BadRequestException, Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { JwtAuthGuard, CurrentUser, type AuthUser } from "./jwt-auth.guard";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  register(@Body() body: { username?: string; password?: string }) {
    const { username = "", password = "" } = body ?? {};
    if (username.length < 2) throw new BadRequestException("username 至少 2 个字符");
    // 与 MinIO root 密码规则对齐（MINIO_ROOT_PASSWORD 至少 8 位），
    // 网站管理员账号同时作为 MinIO root，规则统一避免「网站能建、对象存储起不来」
    if (password.length < 8) throw new BadRequestException("password 至少 8 位（与 MinIO root 密码规则一致）");
    return this.auth.register(username, password);
  }

  @Post("login")
  @HttpCode(200)
  login(@Body() body: { username?: string; password?: string }) {
    return this.auth.login(body?.username ?? "", body?.password ?? "");
  }

  @Post("refresh")
  @HttpCode(200)
  refresh(@Body() body: { refreshToken?: string }) {
    return this.auth.refresh(body?.refreshToken ?? "");
  }

  @Post("logout")
  @HttpCode(200)
  logout(@Body() body: { refreshToken?: string }) {
    this.auth.logout(body?.refreshToken ?? "");
    return { ok: true };
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
