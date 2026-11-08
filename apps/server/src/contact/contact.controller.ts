import { Body, Controller, Get, Param, Put, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, CurrentUser, type AuthUser } from "../auth/jwt-auth.guard";
import { PermissionGuard, RequirePerm } from "../common/permission.guard";
import { ContactService } from "./contact.service";

@Controller("profile")
export class ContactController {
  constructor(private readonly svc: ContactService) {}

  /** 公开只读页 /c/:username 的数据源，按 visibility 过滤，不要求登录 */
  @Get("public/:username")
  getPublic(@Param("username") username: string) {
    return this.svc.getPublic(username);
  }

  /** 本人完整联系信息（含仅自己可见渠道） */
  @Get("contact")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("me:read")
  getOwn(@CurrentUser() user: AuthUser) {
    return this.svc.getOwn(user.id);
  }

  /** 保存联系信息与渠道可见性 */
  @Put("contact")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("me:write")
  update(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.svc.update(user.id, body);
  }
}
