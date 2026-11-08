import {
  BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, UseGuards,
} from "@nestjs/common";
import type { KbAskInput, KbIngestInput } from "@aiwb/shared";
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

  /** 只读原文：读取知识库文档正文（不重新向量化），Agent 通过此接口看原文 */
  @Get("documents/:id/original")
  @RequirePerm("kb:read")
  readOriginal(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.readOriginal(user.id, id);
  }

  /** 重新索引：从归档原文重新走一遍切分/向量化（用于 error 文档重试） */
  @Post("documents/:id/retry")
  @RequirePerm("kb:write")
  async retry(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    try {
      return await this.svc.retryIngest(id, user.id);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  @Post("search")
  @RequirePerm("kb:read")
  search(@CurrentUser() user: AuthUser, @Body() body: { query?: string; topK?: number }) {
    if (!body?.query?.trim()) throw new BadRequestException("query 不能为空");
    return this.svc.search(user.id, body.query, body.topK);
  }

  /** 检索即对话：检索 + 生成带引用的答案；mode 控制检索深度 */
  @Post("ask")
  @RequirePerm("kb:read")
  ask(@CurrentUser() user: AuthUser, @Body() body: KbAskInput) {
    if (!body?.query?.trim()) throw new BadRequestException("query 不能为空");
    return this.svc.ask(user.id, body.query, body.topK, body.mode);
  }

  @Get("search")
  @RequirePerm("kb:read")
  searchGet(@CurrentUser() user: AuthUser, @Query("q") q?: string) {
    if (!q?.trim()) throw new BadRequestException("query 不能为空");
    return this.svc.search(user.id, q);
  }
}
