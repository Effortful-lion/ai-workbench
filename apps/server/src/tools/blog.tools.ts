import { Injectable } from "@nestjs/common";
import type { ToolContext } from "@aiwb/shared";
import { RegisterTool } from "./register-tool.decorator";
import { BlogService } from "../blog/blog.service";

/** blog 模块专属工具：Agent 可检索/巡检已发表文章（内容生产在 KB，博客仅展示层） */
@Injectable()
export class BlogTools {
  constructor(private readonly blog: BlogService) {}

  @RegisterTool({
    name: "blog.search",
    description:
      "全文检索已发表的博客文章（标题/摘要/正文）。用户问「我写过什么/博客里有没有讲过 X」时使用。",
    permission: "blog:read",
    argsSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索关键词，命中标题/摘要/正文任一即返回" },
        limit: { type: "number", description: "返回条数，默认 5，最多 20" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  })
  async search(ctx: ToolContext, args: Record<string, unknown>) {
    const q = String(args.query ?? "").trim().toLowerCase();
    if (!q) throw new Error("query 不能为空");
    const limit = Math.min(20, Number(args.limit ?? 5) || 5);
    const posts = (await this.blog.listPosts(ctx.userId)).filter(
      (p) =>
        p.status === "published" &&
        (p.title.toLowerCase().includes(q) ||
          p.summary.toLowerCase().includes(q) ||
          p.contentMd.toLowerCase().includes(q)),
    );
    return {
      query: q,
      total: posts.length,
      posts: posts.slice(0, limit).map((p) => ({
        slug: p.slug,
        title: p.title,
        summary: p.summary,
        category: p.category,
        tags: p.tags,
        publishedAt: p.publishedAt,
        url: `/b/owner/${p.slug}`,
      })),
    };
  }

  @RegisterTool({
    name: "blog.listPublished",
    description: "列出已发表的博客文章清单（标题/分类/发布时间/评论数），用于巡检或汇总。",
    permission: "blog:read",
    argsSchema: { type: "object", properties: {}, additionalProperties: false },
  })
  async listPublished(ctx: ToolContext) {
    const posts = (await this.blog.listPosts(ctx.userId)).filter((p) => p.status === "published");
    return {
      total: posts.length,
      posts: posts.map((p) => ({
        slug: p.slug,
        title: p.title,
        category: p.category,
        tags: p.tags,
        publishedAt: p.publishedAt,
        commentCount: p.commentCount,
      })),
    };
  }
}
