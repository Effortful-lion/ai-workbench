import { Injectable } from "@nestjs/common";
import type { ToolContext } from "@aiwb/shared";
import { RegisterTool } from "./register-tool.decorator";
import { WebTools } from "./web.tools";
import { GithubService } from "../github/github.service";
import { KbService } from "../kb/kb.service";

interface WebHit {
  title: string;
  url: string;
  snippet: string;
}

interface GithubHit {
  fullName: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  pushedAt: string;
  archived: boolean;
  topics: string[];
  url: string;
}

interface KbHit {
  title: string;
  snippet: string;
}

/** 统一检索：web + github + kb 并行扇出，单源失败只写 degraded，不影响其它源。
 *  与 web.search 分开：web.search 是纯 HTML 抓取无鉴权；search.multi 聚合多源并去重，
 *  两边能独立降级——GitHub 撞限流时，网页结果照常返回。 */
@Injectable()
export class SearchTools {
  constructor(
    private readonly web: WebTools,
    private readonly github: GithubService,
    private readonly kb: KbService,
  ) {}

  @RegisterTool({
    name: "search.multi",
    description:
      "跨源统一检索：并行搜网页（Bing）+ GitHub 仓库 + 本地知识库，自动去重。" +
      "当用户要找开源项目 / 库 / 框架 / 轮子 / repo / 源码，或明确问「GitHub 上有没有」时优先用这个；" +
      "纯资讯、新闻、文档仍用 web.search。GitHub 结果带 stars / pushedAt / archived，用于判断项目能不能拿来用。",
    permission: "tools:read",
    argsSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "搜索词。找 GitHub 项目时建议带限定符，如「rate limit language:go stars:>200」「RAG stars:>500 pushed:>2026-05-01」",
        },
        sources: {
          type: "array",
          items: { type: "string", enum: ["web", "github", "kb"] },
          description: '数据源子集，默认 ["web","github"]；查本地文档加 "kb"',
        },
        count: { type: "number", description: "每源最多返回条数，默认 8，最多 10" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  })
  async multi(
    ctx: ToolContext,
    args: Record<string, unknown>,
  ): Promise<{
    query: string;
    web: WebHit[] | null;
    github: GithubHit[] | null;
    kb: KbHit[] | null;
    degraded?: string[];
  }> {
    const query = String(args.query ?? "").trim();
    if (!query) throw new Error("query 不能为空");
    const sources = Array.isArray(args.sources) && args.sources.length > 0
      ? (args.sources as string[])
      : ["web", "github"];
    const count = Math.min(Math.max(Number(args.count ?? 8) || 8, 1), 10);
    const degraded: string[] = [];

    const jobs: [string, Promise<unknown>][] = [];
    if (sources.includes("web")) {
      jobs.push(["web", this.web.search(ctx, { query, count }).then((r) => r.results)]);
    }
    if (sources.includes("github")) {
      jobs.push([
        "github",
        this.github.searchRepos(ctx.userId, query).then((r) => (r.data as { items: GithubHit[] }).items.slice(0, count)),
      ]);
    }
    if (sources.includes("kb")) {
      jobs.push([
        "kb",
        this.kb.search(ctx.userId, query, count).then((r) =>
          r.hits.map((h) => ({ title: h.docTitle, snippet: h.text.slice(0, 200) })),
        ),
      ]);
    }

    const settled = await Promise.allSettled(jobs.map(([, p]) => p));
    const out: { web: WebHit[] | null; github: GithubHit[] | null; kb: KbHit[] | null } = {
      web: null,
      github: null,
      kb: null,
    };

    settled.forEach((res, i) => {
      const source = jobs[i][0];
      if (res.status === "fulfilled") {
        if (source === "web") out.web = res.value as WebHit[];
        else if (source === "github") out.github = res.value as GithubHit[];
        else out.kb = res.value as KbHit[];
      } else {
        const reason = res.reason instanceof Error ? res.reason.message : String(res.reason);
        // 未配置 token / 限流 / 超时 统一进 degraded，不抛错
        degraded.push(`${source}:${reason.slice(0, 60)}`);
      }
    });

    // 去重：web 命中与 GitHub 仓库同 host+path 时丢 web 那条（GitHub 卡片信息更全）
    if (out.web && out.github && out.github.length > 0) {
      const ghKeys = new Set(out.github.map((g) => normalizeUrlKey(g.url)));
      out.web = out.web.filter((w) => !ghKeys.has(normalizeUrlKey(w.url)));
    }

    if (!out.web && !out.github && !out.kb) {
      throw new Error(`所有数据源都失败：${degraded.join("；") || "未知原因"}`);
    }
    return {
      query,
      web: out.web,
      github: out.github,
      kb: out.kb,
      ...(degraded.length > 0 ? { degraded } : {}),
    };
  }
}

/** host+path 归一：去协议、www、尾斜杠，用于跨源去重 */
function normalizeUrlKey(url: string): string {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "")).toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}
