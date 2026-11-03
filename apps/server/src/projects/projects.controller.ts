import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import type { ProjectDocInput, ProjectDocPatchInput, ProjectInput, ProjectPatchInput } from "@aiwb/shared";
import { JwtAuthGuard, CurrentUser, type AuthUser } from "../auth/jwt-auth.guard";
import { PermissionGuard, RequirePerm } from "../common/permission.guard";
import { ProjectsService } from "./projects.service";

@Controller("projects")
export class ProjectsController {
  constructor(private readonly svc: ProjectsService) {}

  @Get()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("projects:read")
  list(@CurrentUser() user: AuthUser) {
    return this.svc.list(user.id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("projects:write")
  create(@CurrentUser() user: AuthUser, @Body() body: ProjectInput) {
    return this.svc.create(user.id, body);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("projects:write")
  update(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() body: ProjectPatchInput) {
    return this.svc.update(id, user.id, body);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("projects:write")
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.remove(id, user.id).then(() => ({ ok: true }));
  }

  @Get(":id/docs")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("projects:read")
  listDocs(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.listDocs(id, user.id);
  }

  @Get(":id/docs/:docId")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("projects:read")
  getDoc(@Param("id") id: string, @Param("docId") docId: string, @CurrentUser() user: AuthUser) {
    return this.svc.getDoc(id, docId, user.id);
  }

  @Post(":id/docs")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("projects:write")
  createDoc(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() body: ProjectDocInput) {
    return this.svc.createDoc(id, user.id, body);
  }

  @Patch(":id/docs/:docId")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("projects:write")
  updateDoc(
    @Param("id") id: string,
    @Param("docId") docId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: ProjectDocPatchInput,
  ) {
    return this.svc.updateDoc(id, docId, user.id, body);
  }

  @Delete(":id/docs/:docId")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("projects:write")
  removeDoc(@Param("id") id: string, @Param("docId") docId: string, @CurrentUser() user: AuthUser) {
    return this.svc.removeDoc(id, docId, user.id).then(() => ({ ok: true }));
  }
}
