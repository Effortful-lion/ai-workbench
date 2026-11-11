import { Body, Controller, Get, Param, Put, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, CurrentUser, type AuthUser } from "../auth/jwt-auth.guard";
import { PermissionGuard, RequirePerm } from "../common/permission.guard";
import { ContactService } from "./contact.service";

@Controller("profile")
export class ContactController {
  constructor(private readonly svc: ContactService) {}

  /** 游客首页用：站点主人的公开身份（username / nickname），不要求登录 */
  @Get("owner-public")
  ownerPublic() {
    return this.svc.ownerPublic();
  }

  /** 公开只读页 /c/:username 的数据源，按 visibility 过滤，不要求登录 */
  @Get("public/:username")
  getPublic(@Param("username") username: string) {
    return this.svc.getPublic(username);
  }

  /** 本人完整联系信息（含仅自己可见渠道） */
  @Get("contact")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("contact:read")
  getOwn(@CurrentUser() user: AuthUser) {
    return this.svc.getOwn(user.id, user.role === "owner");
  }

  /** 保存联系信息与渠道可见性（只允许站点主人改，member 只读） */
  @Put("contact")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("contact:write")
  update(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.svc.update(user.id, body);
  }
}
