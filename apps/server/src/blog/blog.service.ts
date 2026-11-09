import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  BlogCommentDto,
  BlogCommentInput,
  BlogKbLinkDto,
  BlogPostDto,
  BlogPostPatchInput,
  BlogPostStatus,
  BlogPublishFromKbInput,
  BlogPublicPostDetailDto,
  BlogPublicPostDto,
} from "@aiwb/shared";
import { DB, type Db } from "../db/db.module";
import { blogComments, blogPosts, users } from "../db/schema";
import { KbService } from "../kb/kb.service";
import { NotifyService } from "../notify/notify.service";

const MAX_CONTENT = 200_000;
const MAX_SUMMARY = 200;
const MAX_COMMENT = 2000;

@Injectable()
export class BlogService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly kb: KbService,
    private readonly notify: NotifyService,
  ) {}

  // ---------- 管理态（登录 + blog:read/write） ----------

  async listPosts(userId: string): Promise<BlogPostDto[]> {
    const rows = await this.db
      .select()
      .from(blogPosts)
      .where(eq(blogPosts.ownerId, userId))
      .orderBy(desc(blogPosts.createdAt));
    const counts = await this.commentCountMap(rows.map((r) => r.id));
    return rows.map((r) => this.toDto(r, counts.get(r.id) ?? 0));
  }

  /** 从 KB 文档一键发布（幂等 upsert）：
   *  未发布 → 新建 published；已下架 → 刷新正文重上架；已发布 → 报错「已在博客中」。
   *  同一 KB 文档永远只有一篇博客文章（按 ownerId + kbDocId 收口）。 */
  async publishFromKb(userId: string, input: BlogPublishFromKbInput): Promise<BlogPostDto> {
    if (!input?.kbDocId) throw new BadRequestException("kbDocId 不能为空");
    const original = await this.kb.readOriginal(userId, input.kbDocId);
    const contentMd = original.content.replace(/\r\n/g, "\n").trim();
    if (!contentMd) throw new BadRequestException("KB 文档正文为空，无法发布");
    if (contentMd.length > MAX_CONTENT) throw new BadRequestException("文档过长，请拆分后发布");

    const title = original.title.trim();
    const summary =
      (input.summary?.trim() || firstParagraph(contentMd)).slice(0, MAX_SUMMARY) || title;
    const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 6);
    const now = new Date();

    const [existing] = await this.db
      .select()
      .from(blogPosts)
      .where(and(eq(blogPosts.ownerId, userId), eq(blogPosts.kbDocId, input.kbDocId)));

    if (existing) {
      if (existing.status === "published") {
        throw new BadRequestException("该文档已在博客中发布，请先下架再重新发布");
      }
      const [row] = await this.db
        .update(blogPosts)
        .set({
          title,
          summary,
          contentMd,
          category: input.category,
          tagsJson: tags,
          status: "published",
          publishedAt: now,
          updatedAt: now,
        })
        .where(eq(blogPosts.id, existing.id))
        .returning();
      return this.toDto(row, 0);
    }

    const slug = await this.uniqueSlug();
    const [row] = await this.db
      .insert(blogPosts)
      .values({
        id: randomUUID(),
        ownerId: userId,
        slug,
        title,
        summary,
        contentMd,
        category: input.category,
        tagsJson: tags,
        status: "published",
        kbDocId: input.kbDocId,
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return this.toDto(row, 0);
  }

  /** KB 文档行状态批量查询：kbDocId → 文章（一次查询，避免 N+1） */
  async listKbLinks(userId: string): Promise<BlogKbLinkDto[]> {
    const rows = await this.db
      .select({
        kbDocId: blogPosts.kbDocId,
        postId: blogPosts.id,
        slug: blogPosts.slug,
        title: blogPosts.title,
        status: blogPosts.status,
      })
      .from(blogPosts)
      .where(eq(blogPosts.ownerId, userId));
    return rows
      .filter((r): r is typeof r & { kbDocId: string } => !!r.kbDocId)
      .map((r) => ({
        kbDocId: r.kbDocId,
        postId: r.postId,
        slug: r.slug,
        title: r.title,
        status: r.status,
      }));
  }

  async patchPost(userId: string, id: string, patch: BlogPostPatchInput): Promise<BlogPostDto> {
    const row = await this.mustOwn(userId, id);
    const status: BlogPostStatus = patch.status ?? row.status;
    const [next] = await this.db
      .update(blogPosts)
      .set({
        title: patch.title?.trim() || row.title,
        summary: (patch.summary ?? row.summary).slice(0, MAX_SUMMARY),
        category: patch.category ?? row.category,
        tagsJson: patch.tags?.map((t) => t.trim()).filter(Boolean) ?? row.tagsJson,
        status,
        // draft → published 时补发布时间；已发布保持原值
        publishedAt:
          status === "published" ? (row.publishedAt ?? new Date()) : status === "draft" ? null : row.publishedAt,
        updatedAt: new Date(),
      })
      .where(eq(blogPosts.id, id))
      .returning();
    const counts = await this.commentCountMap([id]);
    return this.toDto(next, counts.get(id) ?? 0);
  }

  async removePost(userId: string, id: string): Promise<void> {
    await this.mustOwn(userId, id);
    await this.db.delete(blogPosts).where(eq(blogPosts.id, id));
  }

  /** 评论管理：列出某文章全部评论（含 hidden） */
  async listCommentsForOwner(userId: string, postId: string): Promise<BlogCommentDto[]> {
    await this.mustOwn(userId, postId);
    return this.listComments(postId, false);
  }

  async setCommentStatus(userId: string, commentId: string, status: "approved" | "hidden"): Promise<void> {
    const [c] = await this.db.select().from(blogComments).where(eq(blogComments.id, commentId));
    if (!c) throw new NotFoundException("comment not found");
    await this.mustOwn(userId, c.postId);
    await this.db.update(blogComments).set({ status }).where(eq(blogComments.id, commentId));
  }

  async removeComment(userId: string, commentId: string): Promise<void> {
    const [c] = await this.db.select().from(blogComments).where(eq(blogComments.id, commentId));
    if (!c) throw new NotFoundException("comment not found");
    await this.mustOwn(userId, c.postId);
    await this.db.delete(blogComments).where(eq(blogComments.id, commentId));
  }

  // ---------- 公开态（匿名） ----------

  async publicList(username: string): Promise<BlogPublicPostDto[]> {
    const owner = await this.mustUser(username);
    const rows = await this.db
      .select()
      .from(blogPosts)
      .where(and(eq(blogPosts.ownerId, owner.id), eq(blogPosts.status, "published")))
      .orderBy(desc(blogPosts.publishedAt));
    const counts = await this.commentCountMap(rows.map((r) => r.id));
    return rows.map((r) => this.toPublicDto(r, counts.get(r.id) ?? 0));
  }

  async publicPost(username: string, slug: string): Promise<BlogPublicPostDetailDto> {
    const owner = await this.mustUser(username);
    const published = await this.db
      .select()
      .from(blogPosts)
      .where(and(eq(blogPosts.ownerId, owner.id), eq(blogPosts.status, "published")))
      .orderBy(desc(blogPosts.publishedAt));
    const ix = published.findIndex((p) => p.slug === slug);
    if (ix < 0) throw new NotFoundException("post not found");
    const row = published[ix];
    const comments = await this.listComments(row.id, true);
    // 列表按发布时间倒序：下一条 = ix+1（更早），上一条 = ix-1（更新）
    const neighbor = (p?: typeof row) =>
      p ? { slug: p.slug, title: p.title } : null;
    return {
      ...this.toPublicDto(row, comments.length),
      contentMd: row.contentMd,
      next: neighbor(published[ix + 1]),
      prev: neighbor(published[ix - 1]),
    };
  }

  /** 公开评论列表：仅 approved */
  async publicComments(username: string, slug: string): Promise<BlogCommentDto[]> {
    const owner = await this.mustUser(username);
    const [post] = await this.db
      .select()
      .from(blogPosts)
      .where(and(eq(blogPosts.ownerId, owner.id), eq(blogPosts.slug, slug)));
    if (!post || post.status !== "published") throw new NotFoundException("post not found");
    return this.listComments(post.id, true);
  }

  /** 发表评论：公开可见、发表需登录；评论人取自登录账号（昵称 = username），直接 approved */
  async addPublicComment(
    username: string,
    slug: string,
    input: BlogCommentInput,
    author: { id: string; username: string },
  ): Promise<BlogCommentDto> {
    const owner = await this.mustUser(username);
    const [post] = await this.db
      .select()
      .from(blogPosts)
      .where(and(eq(blogPosts.ownerId, owner.id), eq(blogPosts.slug, slug)));
    if (!post || post.status !== "published") throw new NotFoundException("post not found");
    const content = (input?.content ?? "").trim().slice(0, MAX_COMMENT);
    if (!content) throw new BadRequestException("评论内容不能为空");
    const nickname = author.username;
    const [row] = await this.db
      .insert(blogComments)
      .values({
        id: randomUUID(),
        postId: post.id,
        userId: author.id,
        nickname,
        content,
        status: "approved",
      })
      .returning();
    await this.notify
      .create(owner.id, {
        type: "blog",
        title: `博客新评论：《${post.title}》`,
        body: `${nickname}：${content.slice(0, 80)}`,
      })
      .catch(() => {});
    return this.toCommentDto(row);
  }

  // ---------- 内部 ----------

  private async mustOwn(userId: string, postId: string) {
    const [row] = await this.db
      .select()
      .from(blogPosts)
      .where(and(eq(blogPosts.ownerId, userId), eq(blogPosts.id, postId)));
    if (!row) throw new NotFoundException("post not found");
    return row;
  }

  private async mustUser(username: string) {
    const [u] = await this.db.select().from(users).where(eq(users.username, username));
    if (!u) throw new NotFoundException("user not found");
    return u;
  }

  private async listComments(postId: string, onlyApproved: boolean): Promise<BlogCommentDto[]> {
    const rows = await this.db
      .select()
      .from(blogComments)
      .where(
        onlyApproved
          ? and(eq(blogComments.postId, postId), eq(blogComments.status, "approved"))
          : eq(blogComments.postId, postId),
      )
      .orderBy(desc(blogComments.createdAt));
    return rows.map((r) => this.toCommentDto(r));
  }

  private async commentCountMap(postIds: string[]): Promise<Map<string, number>> {
    if (!postIds.length) return new Map();
    const rows = await this.db
      .select({ postId: blogComments.postId })
      .from(blogComments)
      .where(and(inArray(blogComments.postId, postIds), eq(blogComments.status, "approved")));
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.postId, (m.get(r.postId) ?? 0) + 1);
    return m;
  }

  /** 8 位短码 slug，撞唯一索引则重试 */
  private async uniqueSlug(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const s = randomUUID().slice(0, 8);
      const [hit] = await this.db.select({ id: blogPosts.id }).from(blogPosts).where(eq(blogPosts.slug, s));
      if (!hit) return s;
    }
    return randomUUID().slice(0, 16);
  }

  private toDto(r: typeof blogPosts.$inferSelect, commentCount: number): BlogPostDto {
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      summary: r.summary,
      contentMd: r.contentMd,
      category: r.category,
      tags: r.tagsJson,
      status: r.status,
      kbDocId: r.kbDocId,
      publishedAt: r.publishedAt?.getTime() ?? null,
      commentCount,
      createdAt: r.createdAt.getTime(),
      updatedAt: r.updatedAt.getTime(),
    };
  }

  private toPublicDto(r: typeof blogPosts.$inferSelect, commentCount: number): BlogPublicPostDto {
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      summary: r.summary,
      category: r.category,
      tags: r.tagsJson,
      publishedAt: r.publishedAt?.getTime() ?? r.createdAt.getTime(),
      commentCount,
      charCount: r.contentMd.length,
    };
  }

  private toCommentDto(r: typeof blogComments.$inferSelect): BlogCommentDto {
    return {
      id: r.id,
      postId: r.postId,
      userId: r.userId,
      nickname: r.nickname,
      content: r.content,
      status: r.status,
      createdAt: r.createdAt.getTime(),
    };
  }
}

/** 摘要：第一个非标题、非空段落的纯文本 */
function firstParagraph(md: string): string {
  for (const line of md.split("\n")) {
    const t = line
      .trim()
      .replace(/^#+\s*/, "")
      .replace(/[*_`>~-]/g, "")
      .trim();
    if (t) return t;
  }
  return "";
}
