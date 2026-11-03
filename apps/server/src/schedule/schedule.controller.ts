import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { ScheduleTaskInput, ScheduleTaskPatchInput } from "@aiwb/shared";
import { JwtAuthGuard, CurrentUser, type AuthUser } from "../auth/jwt-auth.guard";
import { PermissionGuard, RequirePerm } from "../common/permission.guard";
import { ScheduleService } from "./schedule.service";

@Controller("schedule")
export class ScheduleController {
  constructor(private readonly svc: ScheduleService) {}

  @Get("tasks")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("schedule:read")
  list(@CurrentUser() user: AuthUser) {
    return this.svc.list(user.id);
  }

  @Get("upcoming")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("schedule:read")
  upcoming(@CurrentUser() user: AuthUser, @Query("days") days?: string) {
    const n = Number(days);
    return this.svc.upcoming(user.id, Number.isFinite(n) && n > 0 ? n : 7);
  }

  @Post("tasks")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("schedule:write")
  create(@CurrentUser() user: AuthUser, @Body() body: ScheduleTaskInput) {
    return this.svc.create(user.id, body);
  }

  @Patch("tasks/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("schedule:write")
  update(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() body: ScheduleTaskPatchInput) {
    return this.svc.update(id, user.id, body);
  }

  @Delete("tasks/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("schedule:write")
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.remove(id, user.id).then(() => ({ ok: true }));
  }
}
