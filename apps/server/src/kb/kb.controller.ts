import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from "@nestjs/common";
import type {
  KbAskInput, KbCreateFolderInput, KbIngestInput, KbLinkInput, KbSearchInput, KbUpdateFolderInput,
} from "@aiwb/shared";
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

  // ---- 目录树（视图层）----

  @Get("folders")
  @RequirePerm("kb:read")
  listFolders(@CurrentUser() user: AuthUser) {
    return this.svc.listFolders(user.id);
  }

  @Post("folders")
  @RequirePerm("kb:write")
  async createFolder(@CurrentUser() user: AuthUser, @Body() body: KbCreateFolderInput) {
    try {
      return await this.svc.createFolder(user.id, body);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  @Patch("folders/:id")
  @RequirePerm("kb:write")
  async updateFolder(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: KbUpdateFolderInput,
  ) {
    try {
      return await this.svc.updateFolder(user.id, id, body);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /** 删除目录仅删视图与映射；文档本体、向量切片保留 */
  @Delete("folders/:id")
  @RequirePerm("kb:write")
  deleteFolder(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.deleteFolder(user.id, id);
  }

  // ---- 软链接（挂载 / 移除）----

  @Post("links")
  @RequirePerm("kb:write")
  async mount(@CurrentUser() user: AuthUser, @Body() body: KbLinkInput) {
    try {
      return await this.svc.mountDocument(user.id, body);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /** 移除链接：仅删映射行，文档本体/向量/其他目录视图保留 */
  @Delete("links/:id")
  @RequirePerm("kb:write")
  unlink(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.svc.unlink(user.id, id).then(() => ({ ok: true }));
  }

  @Post("search")
  @RequirePerm("kb:read")
  search(@CurrentUser() user: AuthUser, @Body() body: KbSearchInput) {
    if (!body?.query?.trim()) throw new BadRequestException("query 不能为空");
    return this.svc.search(user.id, body.query, body.topK, body.folderId);
  }

  /** 检索即对话：检索 + 生成带引用的答案；mode 控制检索深度 */
  @Post("ask")
  @RequirePerm("kb:read")
  ask(@CurrentUser() user: AuthUser, @Body() body: KbAskInput) {
    if (!body?.query?.trim()) throw new BadRequestException("query 不能为空");
    return this.svc.ask(user.id, body.query, body.topK, body.mode, body.modelId);
  }

  @Get("search")
  @RequirePerm("kb:read")
  searchGet(@CurrentUser() user: AuthUser, @Query("q") q?: string) {
    if (!q?.trim()) throw new BadRequestException("query 不能为空");
    return this.svc.search(user.id, q);
  }
}
