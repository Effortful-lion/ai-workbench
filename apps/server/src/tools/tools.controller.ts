import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import type { UpsertCustomToolInput } from "@aiwb/shared";
import { JwtAuthGuard, CurrentUser, type AuthUser } from "../auth/jwt-auth.guard";
import { PermissionGuard, RequirePerm } from "../common/permission.guard";
import { ToolRegistry } from "./tool-registry.service";
import { CustomToolsService } from "./custom-tools.service";

/** Tool Schema 清单：按当前用户角色过滤后出网（⌘K / Agent 创建页 / LLM 注入共用） */
@Controller("tools")
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ToolsController {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly customTools: CustomToolsService,
  ) {}

  @Get()
  @RequirePerm("tools:read")
  list(@CurrentUser() user: AuthUser) {
    return this.registry.listForRole(user.role);
  }

  // ---------- 自定义工具（AI 自写 / 面板手工） ----------

  @Get("custom")
  @RequirePerm("tools:read")
  listCustom(@CurrentUser() user: AuthUser) {
    return this.customTools.listMine(user.id);
  }

  /** 面板手工创建：直接启用（人工创建本身就是信任动作） */
  @Post("custom")
  @RequirePerm("tools:write")
  createCustom(@CurrentUser() user: AuthUser, @Body() body: UpsertCustomToolInput) {
    return this.customTools.create(user.id, body, "user", true);
  }

  @Patch("custom/:id")
  @RequirePerm("tools:write")
  updateCustom(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: UpsertCustomToolInput,
  ) {
    return this.customTools.update(user.id, id, body);
  }

  @Post("custom/:id/toggle")
  @RequirePerm("tools:write")
  toggleCustom(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.customTools.toggle(user.id, id);
  }

  @Delete("custom/:id")
  @RequirePerm("tools:write")
  removeCustom(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.customTools.remove(user.id, id);
  }
}
