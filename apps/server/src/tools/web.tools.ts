import { Injectable } from "@nestjs/common";
import type { ToolContext } from "@aiwb/shared";
import { RegisterTool } from "./register-tool.decorator";

/** 伪装桌面 Chrome：Bing / 站点对默认 UA 会返回精简页或反爬页 */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const SEARCH_ENDPOINT = "https://www.bing.com/search";
const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_FETCH_CHARS = 12_000;
const MAX_FETCH_CHARS = 30_000;
/** 上限 10 条：一页 Bing 结果足够回答“查一下”，再多多灌 token 没有收益 */
const MAX_RESULTS = 10;

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** 联网工具：搜索用 Bing HTML（无需 API Key），抓取把网页转成可读纯文本。
 *  与操作目录工具不同，这两项没有对应的后端 API，是纯粹的「给 AI 加的手」。 */
@Injectable()
export class WebTools {
  @RegisterTool({
    name: "web.search",
    description: "联网搜索（Bing），返回标题 / 链接 / 摘要；用于查资料、新闻、文档，需要正文时再配 web.fetch",
    permission: "tools:read",
    argsSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词，尽量具体" },
        count: { type: "number", description: "结果条数，默认 8，最多 10" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  })
  async search(
    _ctx: ToolContext,
    args: Record<string, unknown>,
  ): Promise<{ query: string; count: number; results: SearchHit[] }> {
    const query = String(args.query ?? "").trim();
    if (!query) throw new Error("query 不能为空");
    const count = clampCount(args.count);

    const url = `${SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}&count=${count}&setlang=zh-Hans`;
    const res = await fetch(url, {
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`搜索失败：HTTP ${res.status}`);
    const html = await res.text();

    const results = parseBingResults(html, count);
    if (results.length === 0) throw new Error("搜索无结果（页面结构可能已变化）");
    return { query, count: results.length, results };
  }

  @RegisterTool({
    name: "web.fetch",
    description: "抓取网页并转成纯文本（HTML/JSON/纯文本），返回标题与正文；内网与本机地址会被拒绝",
    permission: "tools:read",
    argsSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "完整 http(s) 地址" },
        maxChars: { type: "number", description: "正文最多返回多少字符，默认 12000，最多 30000" },
      },
      required: ["url"],
      additionalProperties: false,
    },
  })
  async fetch(
    _ctx: ToolContext,
    args: Record<string, unknown>,
  ): Promise<{ url: string; status: number; contentType: string; title: string; chars: number; content: string }> {
    const target = assertFetchable(String(args.url ?? ""));
    const maxChars = clampChars(args.maxChars);

    const res = await fetch(target, {
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const contentType = res.headers.get("content-type") ?? "";
    if (/^(image|audio|video)\//.test(contentType) || contentType.includes("application/pdf")) {
      throw new Error(`不支持的内容类型：${contentType || "unknown"}`);
    }
    if (!res.ok) throw new Error(`抓取失败：HTTP ${res.status} ${res.statusText}`.trim());

    const body = (await readLimited(res)).toString("utf8");
    const isHtml = contentType.includes("html") || /^\s*<(!doctype|html)/i.test(body);
    const title = isHtml ? extractTitle(body) : "";
    const content = truncate(isHtml ? htmlToText(body) : pretty(body, contentType), maxChars);

    return { url: res.url || target.toString(), status: res.status, contentType, title, chars: content.length, content };
  }
}

function clampCount(value: unknown): number {
  const n = Number(value ?? 8);
  if (!Number.isFinite(n)) return 8;
  return Math.min(Math.max(Math.floor(n), 1), MAX_RESULTS);
}

function clampChars(value: unknown): number {
  const n = Number(value ?? DEFAULT_FETCH_CHARS);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_FETCH_CHARS;
  return Math.min(Math.floor(n), MAX_FETCH_CHARS);
}

/** 解析 Bing 结果页：按 `li.b_algo` 切块，取 h2>a 标题、首个 p 摘要 */
function parseBingResults(html: string, limit: number): SearchHit[] {
  const chunks = html.split('<li class="b_algo"').slice(1);
  const hits: SearchHit[] = [];
  for (const chunk of chunks) {
    const heading = chunk.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!heading) continue;
    const snippet = chunk.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const title = clean(heading[2]);
    if (!title) continue;
    hits.push({
      title,
      url: realUrl(heading[1]),
      snippet: snippet ? clean(snippet[1]) : "",
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** Bing 常把结果包成 /ck/a?...&u=a1<base64url>，这里还原真实地址 */
function realUrl(href: string): string {
  const decoded = decodeEntities(href);
  try {
    const u = new URL(decoded, "https://www.bing.com");
    if (u.pathname.startsWith("/ck/a")) {
      const raw = u.searchParams.get("u");
      if (!raw) return decoded;
      const b64 = raw.startsWith("a1") ? raw.slice(2) : raw;
      return Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    }
    return u.toString();
  } catch {
    return decoded;
  }
}

/** 本机 / 内网地址一律拒绝，避免被诱导抓取管理接口或云元数据 */
function assertFetchable(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("url 不合法");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("只支持 http / https");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const singleLabel = !host.includes(".") && !host.includes(":");
  const blocked =
    host === "localhost" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80") ||
    singleLabel ||
    /^(127|10|192\.168|169\.254)\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) throw new Error("禁止访问内网 / 本机地址");
  return url;
}

async function readLimited(res: Response): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) throw new Error(`响应过大：${declared} bytes`);
  if (!res.body) return Buffer.alloc(0);

  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`响应超过 ${MAX_BYTES} bytes 上限`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? clean(m[1]) : "";
}

/** HTML → 纯文本：去脚本/样式/注释，块级标签换行，压缩空白 */
function htmlToText(html: string): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return tidy(text);
}

function pretty(body: string, contentType: string): string {
  if (contentType.includes("json")) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  return body;
}

function clean(fragment: string): string {
  return tidy(fragment.replace(/<[^>]+>/g, " "));
}

function tidy(text: string): string {
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return named[entity.toLowerCase()] ?? whole;
  });
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n…（已截断，原文 ${text.length} 字符）` : text;
}
