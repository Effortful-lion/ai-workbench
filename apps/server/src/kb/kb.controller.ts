import {
  BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, UseGuards,
} from "@nestjs/common";
import type { KbIngestInput } from "@aiwb/shared";
import { JwtAuthGuard, CurrentUser, type AuthUser } from "../auth/jwt-auth.guard";
import { PermissionGuard, RequirePerm } from "../common/permission.guard";
import { KbService } from "./kb.service";

@Controller("kb")
@UseGuards(JwtAuthGuard, PermissionGuard)
export class KbController {
  constructor(private readonly svc: KbService) {}

  @Get("documents")
  @RequirePerm("kb:read")
  list(@CurrentUser() user: AuthUser) {
    return this.svc.listDocuments(user.id);
  }

  @Post("documents")
  @RequirePerm("kb:write")
  async ingest(@CurrentUser() user: AuthUser, @Body() body: KbIngestInput) {
    try {
      return await this.svc.ingest(user.id, body);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  @Delete("documents/:id")
  @RequirePerm("kb:write")
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.removeDocument(id, user.id).then(() => ({ ok: true }));
  }

  @Post("search")
  @RequirePerm("kb:read")
  search(@CurrentUser() user: AuthUser, @Body() body: { query?: string; topK?: number }) {
    if (!body?.query?.trim()) throw new BadRequestException("query 不能为空");
    return this.svc.search(user.id, body.query, body.topK);
  }

  /** 检索即对话：检索 + 生成带引用的答案 */
  @Post("ask")
  @RequirePerm("kb:read")
  ask(@CurrentUser() user: AuthUser, @Body() body: { query?: string; topK?: number }) {
    if (!body?.query?.trim()) throw new BadRequestException("query 不能为空");
    return this.svc.ask(user.id, body.query, body.topK);
  }

  @Get("search")
  @RequirePerm("kb:read")
  searchGet(@CurrentUser() user: AuthUser, @Query("q") q?: string) {
    if (!q?.trim()) throw new BadRequestException("query 不能为空");
    return this.svc.search(user.id, q);
  }
}
