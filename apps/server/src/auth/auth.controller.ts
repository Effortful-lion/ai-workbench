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
    if (password.length < 6) throw new BadRequestException("password 至少 6 个字符");
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
