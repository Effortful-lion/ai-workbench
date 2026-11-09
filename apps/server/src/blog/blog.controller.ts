import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, UseGuards,
} from "@nestjs/common";
import type {
  BlogCommentInput, BlogPostPatchInput, BlogPublishFromKbInput,
} from "@aiwb/shared";
import { JwtAuthGuard, CurrentUser, type AuthUser } from "../auth/jwt-auth.guard";
import { PermissionGuard, RequirePerm } from "../common/permission.guard";
import { BlogService } from "./blog.service";

/** 博客控制器：管理路由带鉴权，公开路由（public/*）匿名可访问 */
@Controller("blog")
export class BlogController {
  constructor(private readonly svc: BlogService) {}

  // ---- 管理态 ----

  @Get("posts")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("blog:read")
  list(@CurrentUser() user: AuthUser) {
    return this.svc.listPosts(user.id);
  }

  /** KB 文档行状态映射（发布/下架/上架按钮组的数据源，批量一次查询） */
  @Get("kb-links")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("blog:read")
  async kbLinks(@CurrentUser() user: AuthUser) {
    try {
      return await this.svc.listKbLinks(user.id);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /** KB 文档一键发布（内容生产在 KB 完成，博客只做展示层副本） */
  @Post("from-kb")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("blog:write")
  async publishFromKb(@CurrentUser() user: AuthUser, @Body() body: BlogPublishFromKbInput) {
    try {
      return await this.svc.publishFromKb(user.id, body);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  @Patch("posts/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("blog:write")
  async patch(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: BlogPostPatchInput,
  ) {
    try {
      return await this.svc.patchPost(user.id, id, body);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  @Delete("posts/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("blog:write")
  async remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    try {
      await this.svc.removePost(user.id, id);
      return { ok: true };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  @Get("posts/:id/comments")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("blog:read")
  async listComments(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    try {
      return await this.svc.listCommentsForOwner(user.id, id);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  @Patch("comments/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("blog:write")
  async setCommentStatus(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { status: "approved" | "hidden" },
  ) {
    try {
      await this.svc.setCommentStatus(user.id, id, body?.status === "hidden" ? "hidden" : "approved");
      return { ok: true };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  @Delete("comments/:id")
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("blog:write")
  async removeComment(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    try {
      await this.svc.removeComment(user.id, id);
      return { ok: true };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  // ---- 公开态（匿名，参照 toolbox public 模式）----

  @Get("public/:username")
  publicList(@Param("username") username: string) {
    return this.svc.publicList(username);
  }

  /** 公开路由不捕获异常：service 抛的 404/400 原样传递（不存在的文章应 404 而非 400） */
  @Get("public/:username/:slug")
  publicPost(@Param("username") username: string, @Param("slug") slug: string) {
    return this.svc.publicPost(username, slug);
  }

  @Get("public/:username/:slug/comments")
  publicComments(@Param("username") username: string, @Param("slug") slug: string) {
    return this.svc.publicComments(username, slug);
  }

  @Post("public/:username/:slug/comments")
  addPublicComment(
    @Param("username") username: string,
    @Param("slug") slug: string,
    @Body() body: BlogCommentInput,
  ) {
    return this.svc.addPublicComment(username, slug, body);
  }
}
