import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import type { CodeFileInput, CodeFilePatchInput, CodeRepoInput, CodeRepoPatchInput } from "@aiwb/shared";
import { JwtAuthGuard, CurrentUser, type AuthUser } from "../auth/jwt-auth.guard";
import { PermissionGuard, RequirePerm } from "../common/permission.guard";
import { CodeService } from "./code.service";

@Controller("code")
export class CodeController {
  constructor(private readonly svc: CodeService) {}

  @Get("repos")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("code:read")
  listRepos(@CurrentUser() user: AuthUser) {
    return this.svc.listRepos(user.id);
  }

  @Post("repos")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("code:write")
  createRepo(@CurrentUser() user: AuthUser, @Body() body: CodeRepoInput) {
    return this.svc.createRepo(user.id, body);
  }

  @Patch("repos/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("code:write")
  updateRepo(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() body: CodeRepoPatchInput) {
    return this.svc.updateRepo(id, user.id, body);
  }

  @Delete("repos/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("code:write")
  removeRepo(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.removeRepo(id, user.id).then(() => ({ ok: true }));
  }

  @Get("repos/:id/files")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("code:read")
  listFiles(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.listFiles(id, user.id);
  }

  @Get("repos/:id/files/:fileId")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("code:read")
  getFile(@Param("id") id: string, @Param("fileId") fileId: string, @CurrentUser() user: AuthUser) {
    return this.svc.getFile(id, fileId, user.id);
  }

  @Post("repos/:id/files")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("code:write")
  createFile(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() body: CodeFileInput) {
    return this.svc.createFile(id, user.id, body);
  }

  @Patch("repos/:id/files/:fileId")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("code:write")
  updateFile(
    @Param("id") id: string,
    @Param("fileId") fileId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: CodeFilePatchInput,
  ) {
    return this.svc.updateFile(id, fileId, user.id, body);
  }

  @Delete("repos/:id/files/:fileId")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("code:write")
  removeFile(@Param("id") id: string, @Param("fileId") fileId: string, @CurrentUser() user: AuthUser) {
    return this.svc.removeFile(id, fileId, user.id).then(() => ({ ok: true }));
  }
}
