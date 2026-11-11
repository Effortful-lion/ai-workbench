import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { NotificationInput, NotificationType } from "@aiwb/shared";
import { JwtAuthGuard, CurrentUser, type AuthUser } from "../auth/jwt-auth.guard";
import { PermissionGuard, RequirePerm } from "../common/permission.guard";
import { NotifyService } from "./notify.service";

@Controller("notify")
export class NotifyController {
  constructor(private readonly svc: NotifyService) {}

  @Get("digest")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("notify:read")
  digest(@CurrentUser() user: AuthUser) {
    return this.svc.digest(user.id, user.role !== "owner");
  }

  @Get("notifications")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("notify:read")
  list(
    @CurrentUser() user: AuthUser,
    @Query("type") type?: string,
    @Query("unread") unread?: string,
  ) {
    return this.svc.list(
      user.id,
      {
        type: type ? (type as NotificationType) : undefined,
        unreadOnly: unread === "1" || unread === "true",
      },
      user.role !== "owner",
    );
  }

  @Post("notifications")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("notify:write")
  create(@CurrentUser() user: AuthUser, @Body() body: NotificationInput) {
    return this.svc.create(user.id, body, user.role === "owner");
  }

  /** 扫描日程/邮件生成提醒：读的是 admin 的工作流，仅 owner 可触发 */
  @Post("scan")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("notify:scan")
  scan(@CurrentUser() user: AuthUser) {
    return this.svc.scan(user.id);
  }

  @Post("read-all")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("notify:write")
  readAll(@CurrentUser() user: AuthUser) {
    return this.svc.markAllRead(user.id);
  }

  @Patch("notifications/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("notify:write")
  update(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { isRead?: boolean },
  ) {
    return this.svc.markRead(user.id, id, Boolean(body?.isRead));
  }

  @Delete("notifications/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("notify:write")
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.remove(user.id, id).then(() => ({ ok: true }));
  }
}
