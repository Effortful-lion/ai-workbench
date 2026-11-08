import { Injectable } from "@nestjs/common";
import type { ToolContext } from "@aiwb/shared";
import { RegisterTool } from "./register-tool.decorator";
import { KbService } from "../kb/kb.service";

/** kb 模块专属工具：Agent 检索知识库（全局或目录范围）。
 *  search.multi 的 kb 源保持全局语义不变；本工具补充目录范围能力。 */
@Injectable()
export class KbTools {
  constructor(private readonly kb: KbService) {}

  @RegisterTool({
    name: "kb.search",
    description:
      "检索本地知识库片段（文档/笔记/手册）。查站内资料时优先用；" +
      "用户限定「某目录/某分类下」时传 folderId 只在挂载文档内检索。",
    permission: "kb:read",
    argsSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索关键词" },
        topK: { type: "number", description: "返回片段数，默认 5，最多 20" },
        folderId: {
          type: "string",
          description: "目录 id：传入则只在该目录（含子目录）挂载的文档内检索",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  })
  async search(ctx: ToolContext, args: Record<string, unknown>) {
    const query = String(args.query ?? "").trim();
    if (!query) throw new Error("query 不能为空");
    const topK = Number(args.topK ?? 5) || 5;
    const folderId = args.folderId ? String(args.folderId) : undefined;
    const r = await this.kb.search(ctx.userId, query, topK, folderId);
    return {
      query: r.query,
      scope: folderId ? `folder:${folderId}` : "global",
      ...(r.scopeFiltered
        ? { note: "当前链路不支持原生范围过滤，结果为全局召回后按目录过滤，可能不全" }
        : {}),
      hits: r.hits.map((h) => ({
        title: h.docTitle,
        path: h.primaryPath,
        chunk: h.chunkIx,
        score: h.score,
        snippet: h.text.slice(0, 200),
      })),
    };
  }
}
