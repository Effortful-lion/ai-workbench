import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  BlogCommentDto,
  BlogCommentInput,
  BlogCommentPageDto,
  BlogCommentStatus,
  BlogKbLinkDto,
  BlogModerationItemDto,
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
/** 同一文章同一用户的最小发言间隔 / 相同内容去重窗口 */
const COMMENT_RATE_MS = 10_000;
const COMMENT_DUP_MS = 60_000;
const DEFAULT_PAGE_SIZE = 10;
/** 命中即进入人工待审的敏感词（可后续挪到配置） */
const REVIEW_KEYWORDS = ["加微信", "代开发票", "博彩", "赌场", "贷款秒批", "返利", "刷单"];
/** 链接数超过该值进入人工待审 */
const REVIEW_LINK_LIMIT = 2;

/** 自动分流：博主本人不审；敏感词 / 链接过多 / 连续大写刷屏进人工 */
function needsReview(content: string): boolean {
  const links = (content.match(/https?:\/\//gi) ?? []).length;
  if (links > REVIEW_LINK_LIMIT) return true;
  if (REVIEW_KEYWORDS.some((k) => content.includes(k))) return true;
  const hasLongCaps = /[A-Z]{20,}/.test(content);
  return hasLongCaps;
}

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

  /** 公开评论：一级分页 + 子评论批量 + 内存组装（只返回 approved） */
  async publicComments(
    username: string,
    slug: string,
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<BlogCommentPageDto> {
    const owner = await this.mustUser(username);
    const [post] = await this.db
      .select()
      .from(blogPosts)
      .where(and(eq(blogPosts.ownerId, owner.id), eq(blogPosts.slug, slug)));
    if (!post || post.status !== "published") throw new NotFoundException("post not found");

    const p = Math.max(1, page);
    const size = Math.min(50, Math.max(1, pageSize));
    const rootWhere = and(
      eq(blogComments.postId, post.id),
      eq(blogComments.depth, 0),
      eq(blogComments.status, "approved"),
    );
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(blogComments)
      .where(rootWhere);
    // 楼层数用于分页，评论总条数（含回复）用于「评论 · N」展示
    const [{ allTotal }] = await this.db
      .select({ allTotal: count() })
      .from(blogComments)
      .where(and(eq(blogComments.postId, post.id), eq(blogComments.status, "approved")));
    const rootTotal = Number(total ?? 0);
    const commentTotal = Number(allTotal ?? 0);
    const roots = await this.db
      .select()
      .from(blogComments)
      .where(rootWhere)
      .orderBy(desc(blogComments.createdAt))
      .limit(size)
      .offset((p - 1) * size);
    if (roots.length === 0) {
      return { threads: [], total: rootTotal, commentTotal, page: p, pageSize: size };
    }
    const children = await this.db
      .select()
      .from(blogComments)
      .where(
        and(
          inArray(blogComments.rootId, roots.map((r) => r.id)),
          eq(blogComments.depth, 1),
          eq(blogComments.status, "approved"),
        ),
      )
      .orderBy(blogComments.createdAt);
    const grouped = new Map<string, BlogCommentDto[]>();
    for (const c of children) {
      const list = grouped.get(c.rootId) ?? [];
      list.push(this.toCommentDto(c));
      grouped.set(c.rootId, list);
    }
    return {
      threads: roots.map((r) => ({ root: this.toCommentDto(r), children: grouped.get(r.id) ?? [] })),
      total: rootTotal,
      commentTotal,
      page: p,
      pageSize: size,
    };
  }

  /** 发表评论：登录身份；规则自动分流 approved / pending（不阻塞，写后立即可见状态） */
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

    // 频率与重复：同一用户在同一篇文章下 10s 一条、60s 内不许重复内容
    const [last] = await this.db
      .select()
      .from(blogComments)
      .where(and(eq(blogComments.postId, post.id), eq(blogComments.userId, author.id)))
      .orderBy(desc(blogComments.createdAt))
      .limit(1);
    if (last) {
      const gap = Date.now() - last.createdAt.getTime();
      if (gap < COMMENT_RATE_MS) throw new BadRequestException("发言过快，请稍后再试");
      if (last.content === content && gap < COMMENT_DUP_MS) {
        throw new BadRequestException("请勿重复提交相同内容");
      }
    }

    // 回复：继承 rootId，深度压平到 2 级；冗余被回复人
    let rootId = "";
    let parentId = "";
    let depth = 0;
    let replyToUserId: string | null = null;
    let replyToUsername: string | null = null;
    let parentNickname = "";
    if (input?.parentId) {
      const [parent] = await this.db
        .select()
        .from(blogComments)
        .where(and(eq(blogComments.id, input.parentId), eq(blogComments.postId, post.id)));
      if (!parent || parent.status !== "approved") throw new BadRequestException("回复的评论不存在");
      rootId = parent.depth === 0 ? parent.id : parent.rootId;
      parentId = rootId;
      depth = 1;
      replyToUserId = parent.userId;
      replyToUsername = parent.nickname;
      parentNickname = parent.nickname;
    }

    // 自动分流：博主本人直接通过；命中敏感词/链接过多的进入待审
    const isOwner = owner.id === author.id;
    const pending = !isOwner && needsReview(content);

    const id = randomUUID();
    const [row] = await this.db
      .insert(blogComments)
      .values({
        id,
        postId: post.id,
        userId: author.id,
        nickname: author.username,
        content,
        rootId: depth === 0 ? id : rootId,
        parentId,
        replyToUserId,
        replyToUsername,
        depth,
        status: pending ? "pending" : "approved",
      })
      .returning();

    if (pending) {
      await this.notify
        .create(owner.id, {
          type: "blog",
          title: `待审核评论：《${post.title}》`,
          body: `${author.username}：${content.slice(0, 80)}`,
        })
        .catch(() => {});
    } else if (replyToUserId && replyToUserId !== author.id) {
      await this.notify
        .create(replyToUserId, {
          type: "blog",
          title: `有人在《${post.title}》回复了你`,
          body: `${author.username} 回复 ${parentNickname}：${content.slice(0, 80)}`,
        })
        .catch(() => {});
    } else if (owner.id !== author.id) {
      await this.notify
        .create(owner.id, {
          type: "blog",
          title: `博客新评论：《${post.title}》`,
          body: `${author.username}：${content.slice(0, 80)}`,
        })
        .catch(() => {});
    }
    return this.toCommentDto(row);
  }

  // ---------- 审核台 ----------

  /** 审核队列：按状态列出评论（含文章标题），默认 pending 优先 */
  async listForModeration(
    userId: string,
    status?: BlogCommentStatus,
  ): Promise<BlogModerationItemDto[]> {
    const rows = await this.db
      .select({ c: blogComments, title: blogPosts.title, slug: blogPosts.slug })
      .from(blogComments)
      .innerJoin(blogPosts, eq(blogComments.postId, blogPosts.id))
      .where(
        status
          ? and(eq(blogPosts.ownerId, userId), eq(blogComments.status, status))
          : eq(blogPosts.ownerId, userId),
      )
      .orderBy(desc(blogComments.createdAt));
    return rows.map((r) => ({
      comment: this.toCommentDto(r.c),
      postTitle: r.title,
      postSlug: r.slug,
    }));
  }

  /** 审核动作：pending→approved/rejected，approved→hidden，rejected→approved 等 */
  async reviewComment(
    userId: string,
    commentId: string,
    status: BlogCommentStatus,
    note?: string,
  ): Promise<void> {
    const [c] = await this.db.select().from(blogComments).where(eq(blogComments.id, commentId));
    if (!c) throw new NotFoundException("comment not found");
    await this.mustOwn(userId, c.postId);
    await this.db
      .update(blogComments)
      .set({
        status,
        reviewNote: note?.trim().slice(0, 200) ?? c.reviewNote,
        reviewedAt: new Date(),
      })
      .where(eq(blogComments.id, commentId));

    // 结论回告评论者（自己审自己不再通知）
    if (c.userId && c.userId !== userId && (status === "approved" || status === "rejected")) {
      const [post] = await this.db.select().from(blogPosts).where(eq(blogPosts.id, c.postId));
      await this.notify
        .create(c.userId, {
          type: "blog",
          title: status === "approved" ? "你的评论已通过审核" : "你的评论未通过审核",
          body:
            (post ? `《${post.title}》：` : "") +
            (note?.trim() ? note.trim().slice(0, 80) : c.content.slice(0, 80)),
        })
        .catch(() => {});
    }
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
      rootId: r.rootId,
      parentId: r.parentId,
      replyToUserId: r.replyToUserId,
      replyToUsername: r.replyToUsername,
      depth: r.depth,
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
