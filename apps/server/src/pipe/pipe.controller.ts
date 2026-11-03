import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { PipeSopInput, PipeSopPatchInput } from "@aiwb/shared";
import { JwtAuthGuard, CurrentUser, type AuthUser } from "../auth/jwt-auth.guard";
import { PermissionGuard, RequirePerm } from "../common/permission.guard";
import { PipeService } from "./pipe.service";

@Controller("pipe")
export class PipeController {
  constructor(private readonly svc: PipeService) {}

  @Get("digest")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("pipe:read")
  digest(@CurrentUser() user: AuthUser) {
    return this.svc.digest(user.id);
  }

  @Get("sops")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("pipe:read")
  listSops(@CurrentUser() user: AuthUser, @Query("q") q?: string) {
    return this.svc.listSops(user.id, { q });
  }

  @Post("sops")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("pipe:write")
  createSop(@CurrentUser() user: AuthUser, @Body() body: PipeSopInput) {
    return this.svc.createSop(user.id, body);
  }

  @Get("sops/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("pipe:read")
  getSop(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.getSop(user.id, id);
  }

  @Patch("sops/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("pipe:write")
  patchSop(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: PipeSopPatchInput,
  ) {
    return this.svc.patchSop(user.id, id, body);
  }

  @Delete("sops/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("pipe:write")
  removeSop(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.removeSop(user.id, id).then(() => ({ ok: true }));
  }

  @Post("sops/:id/run")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("pipe:write")
  runSop(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { input?: string },
  ) {
    return this.svc.runSop(user.id, id, body?.input);
  }

  @Get("runs")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("pipe:read")
  listRuns(@CurrentUser() user: AuthUser, @Query("limit") limit?: string) {
    return this.svc.listRuns(user.id, limit ? Number(limit) : undefined);
  }

  @Get("runs/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("pipe:read")
  getRun(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.getRun(user.id, id);
  }

  @Post("runs/:id/retry")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("pipe:write")
  retryRun(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.retryRun(user.id, id);
  }
}
