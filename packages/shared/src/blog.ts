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

export const BLOG_COMMENT_STATUSES = ["approved", "hidden"] as const;
export type BlogCommentStatus = (typeof BLOG_COMMENT_STATUSES)[number];

export interface BlogCommentDto {
  id: string;
  postId: string;
  /** 可空 = 游客评论（仅昵称） */
  userId: string | null;
  nickname: string;
  content: string;
  status: BlogCommentStatus;
  createdAt: number;
}

export interface BlogCommentInput {
  /** 游客必填昵称；登录用户可省略（v1 公开页均为游客评论） */
  nickname?: string;
  content: string;
}
