/** 博客子模块共享类型 —— 展示层（文章 + 评论），内容生产全部在 KB 完成 */

export const BLOG_CATEGORIES = ["kb", "agent", "pipe", "essay"] as const;
export type BlogCategory = (typeof BLOG_CATEGORIES)[number];

export const BLOG_POST_STATUSES = ["draft", "published", "archived"] as const;
export type BlogPostStatus = (typeof BLOG_POST_STATUSES)[number];

export interface BlogPostDto {
  id: string;
  /** 公开页 URL 段 /b/:username/:slug */
  slug: string;
  title: string;
  summary: string;
  contentMd: string;
  category: BlogCategory;
  tags: string[];
  status: BlogPostStatus;
  /** 来源 KB 文档 id（发布时回链；博客不存内容生产副本之外的第二个事实源） */
  kbDocId: string | null;
  publishedAt: number | null;
  commentCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface BlogPublicPostDto {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: BlogCategory;
  tags: string[];
  publishedAt: number;
  commentCount: number;
  /** 正文字符数（卡片字数刻度 / 「最长」排序依据，免拉全文） */
  charCount: number;
}

export interface BlogPublicPostDetailDto extends BlogPublicPostDto {
  contentMd: string;
  /** 上下篇：按 publishedAt 排序的相邻文章（列表页顺序） */
  prev: BlogPostNeighborDto | null;
  next: BlogPostNeighborDto | null;
}

export interface BlogPostNeighborDto {
  slug: string;
  title: string;
}

/** KB 文档 → 博客文章的状态映射（KB 文档行动作组的数据源，批量一次查询） */
export interface BlogKbLinkDto {
  kbDocId: string;
  postId: string;
  slug: string;
  title: string;
  status: BlogPostStatus;
}

/** 从 KB 文档一键发布：标题/正文取自 KB 归档原文，slug/摘要自动生成 */
export interface BlogPublishFromKbInput {
  kbDocId: string;
  category: BlogCategory;
  tags?: string[];
  summary?: string;
}

/** 部分更新：标题/摘要/分类/标签/状态（发布与下架走 status 流转） */
export interface BlogPostPatchInput {
  title?: string;
  summary?: string;
  category?: BlogCategory;
  tags?: string[];
  status?: BlogPostStatus;
}

export const BLOG_COMMENT_STATUSES = ["pending", "approved", "rejected", "hidden"] as const;
export type BlogCommentStatus = (typeof BLOG_COMMENT_STATUSES)[number];

/**
 * 评论：树形模型用 root_id + parent_id + 写时冗余，展示强制压平到 2 级。
 * - rootId：顶级评论 id（顶级评论自身 rootId = 自身 id）
 * - parentId：空串 = 顶级；二级回复指向根评论
 * - depth：0 = 顶级，1 = 回复；更深的回复压平到 1
 */
export interface BlogCommentDto {
  id: string;
  postId: string;
  userId: string | null;
  nickname: string;
  content: string;
  rootId: string;
  parentId: string;
  /** 冗余：被回复人（避免渲染时联表查用户） */
  replyToUserId: string | null;
  replyToUsername: string | null;
  depth: number;
  status: BlogCommentStatus;
  createdAt: number;
}

/** 发表评论：身份取登录账号；parentId 空 = 顶级，否则为被回复评论 id */
export interface BlogCommentInput {
  content: string;
  parentId?: string | null;
}

/** 一级评论 + 其下回复（内存组装后的展示单元） */
export interface BlogCommentThreadDto {
  root: BlogCommentDto;
  children: BlogCommentDto[];
}

/** 分页：先一级分页，再按 rootId 批量取子评论 */
export interface BlogCommentPageDto {
  threads: BlogCommentThreadDto[];
  /** 一级评论总数（不含回复） */
  total: number;
  page: number;
  pageSize: number;
}

/** 审核台条目：评论 + 所属文章标题 */
export interface BlogModerationItemDto {
  comment: BlogCommentDto;
  postTitle: string;
  postSlug: string;
}

export interface BlogModerationPatchInput {
  status: BlogCommentStatus;
  note?: string;
}
