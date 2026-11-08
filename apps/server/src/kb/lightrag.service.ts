import { Injectable, Logger } from "@nestjs/common";
import type { KbAskMode } from "@aiwb/shared";

const LIGHTRAG_URL = process.env.LIGHTRAG_URL ?? "http://localhost:9621";
const LIGHTRAG_API_KEY = process.env.LIGHTRAG_API_KEY ?? "";
/** deep（图谱推理）底层模式：mix=图谱+向量；可改 local/global/hybrid */
const DEEP_MODE = process.env.LIGHTRAG_DEEP_MODE ?? process.env.LIGHTRAG_QUERY_MODE ?? "mix";
/** quick（向量直取）底层模式：naive 仅走向量，跳过图谱抽取与多跳 */
const QUICK_MODE = process.env.LIGHTRAG_QUICK_MODE ?? "naive";
/** 无 mode 的调用（如纯检索接口）使用的模式 */
const SEARCH_MODE = process.env.LIGHTRAG_SEARCH_MODE ?? DEEP_MODE;
/** 查询结果缓存 TTL：同一问题重复提问直接命中（摄入/删除文档时整体失效） */
const QUERY_CACHE_TTL_MS = Number(process.env.LIGHTRAG_CACHE_TTL_MS ?? 300_000);
const QUERY_CACHE_MAX = 200;
/** 摄入后轮询处理状态的最长等待。LightRAG 处理为串行队列（图谱抽取走 LLM，
 *  单文档可达分钟级，且需排队等前序文档），默认给 10 分钟，超时翻转为 error */
const INGEST_POLL_TIMEOUT_MS = Number(process.env.LIGHTRAG_INGEST_TIMEOUT_MS ?? 600_000);

export interface LightRagChunk {
  reference_id: string;
  content: string;
  file_path?: string;
}

interface LightRagDocStatus {
  id: string;
  file_path: string;
  status: string;
  chunks_count?: number;
  error_msg?: string | null;
}

/** LightRAG 独立服务（services/lightrag）的纯 HTTP client。
 *  二开边界：对 LightRAG 本体零改动，全部交互经由官方 REST API；
 *  file_source 约定为 kb_documents 的 docId，用于把服务侧文档映射回主仓数据行。 */
@Injectable()
export class LightRagService {
  private readonly log = new Logger("kb:lightrag");
  /** 问答/检索结果缓存：key = 接口+模式+参数；值为结果对象 */
  private readonly cache = new Map<string, { at: number; value: unknown }>();

  available() {
    return Boolean(LIGHTRAG_API_KEY);
  }

  /** 语料变更（摄入完成 / 删除文档）后清空，避免旧答案引用已删内容 */
  clearCache() {
    this.cache.clear();
  }

  /** TTL 缓存包装：命中直接返回，未命中执行后写入并做容量淘汰 */
  private async cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < QUERY_CACHE_TTL_MS) return hit.value as T;
    const value = await fn();
    if (QUERY_CACHE_TTL_MS > 0) {
      this.cache.set(key, { at: Date.now(), value });
      if (this.cache.size > QUERY_CACHE_MAX) {
        const oldest = [...this.cache.entries()]
          .sort((a, b) => a[1].at - b[1].at)
          .slice(0, QUERY_CACHE_MAX / 2);
        for (const [k] of oldest) this.cache.delete(k);
      }
    }
    return value;
  }

  private async req<T>(method: string, path: string, body?: unknown, timeoutMs = 15_000): Promise<T> {
    const res = await fetch(`${LIGHTRAG_URL}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "X-API-Key": LIGHTRAG_API_KEY,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`lightrag ${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }

  /** 摄入文本；LightRAG 异步做切分 + 图谱抽取 + 向量化，返回 track_id */
  async insertText(docId: string, content: string): Promise<void> {
    const r = await this.req<{ status: string; message: string }>(
      "POST",
      "/documents/text",
      { text: content, file_source: fileSource(docId) },
      30_000,
    );
    if (r.status === "failure") throw new Error(`insert failed: ${r.message}`);
  }

  /** 轮询直到文档处理完成（PROCESSED / FAILED），返回 chunk 数 */
  async waitProcessed(docId: string): Promise<{ chunks: number }> {
    const deadline = Date.now() + INGEST_POLL_TIMEOUT_MS;
    for (;;) {
      const doc = await this.findDoc(docId);
      if (doc) {
        const st = doc.status.toUpperCase();
        if (st === "PROCESSED" || st === "PARTIAL" || st === "PARTIALLY_PROCESSED") {
          return { chunks: doc.chunks_count ?? 0 };
        }
        if (st === "FAILED") throw new Error(doc.error_msg || "lightrag 文档处理失败");
      }
      if (Date.now() > deadline) throw new Error("lightrag 文档处理超时");
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  /** 生成式问答（图谱 RAG）；mode 决定检索深度，同一 (问题, 模式) 在 TTL 内命中缓存 */
  async query(query: string, mode?: KbAskMode): Promise<string> {
    const rm = modeFor(mode);
    const key = `query:${rm}:${query}`;
    return this.cached(key, async () => {
      const r = await this.req<{ response: string }>(
        "POST",
        "/query",
        { query, mode: rm },
        120_000,
      );
      return r.response?.trim() ?? "";
    });
  }

  /** 结构化检索：返回图谱实体/关系与原始 chunk（不生成答案）；同参数命中缓存 */
  async queryData(query: string, topK: number, mode?: KbAskMode): Promise<LightRagChunk[]> {
    const rm = modeFor(mode);
    const key = `data:${rm}:${topK}:${query}`;
    return this.cached(key, async () => {
      const r = await this.req<{ status: string; data?: { chunks?: LightRagChunk[] } }>(
        "POST",
        "/query/data",
        { query, mode: rm, top_k: topK },
        120_000,
      );
      if (r.status !== "success") return [];
      return r.data?.chunks ?? [];
    });
  }

  /** 按 file_source 反查服务侧文档（拿 doc-<hash> 内部 id 与状态） */
  private async findDoc(docId: string): Promise<LightRagDocStatus | null> {
    const r = await this.req<{ documents?: LightRagDocStatus[] }>(
      "POST",
      "/documents/paginated",
      { page: 1, page_size: 50, sort_field: "updated_at", sort_direction: "desc" },
    );
    return (r.documents ?? []).find((d) => d.file_path === fileSource(docId)) ?? null;
  }

  /** 列出所有已摄入文档的 file_path（不占 LLM/embedding 资源，pipeline 忙时也可用）。
   *  用于能力文档等系统级内容的存在性判断，避免用 queryData 检查时被 busy pipeline 阻塞。 */
  async listDocPaths(): Promise<string[]> {
    const paths: string[] = [];
    for (let page = 1; page <= 10; page++) {
      const r = await this.req<{ documents?: LightRagDocStatus[] }>(
        "POST",
        "/documents/paginated",
        { page, page_size: 100, sort_field: "updated_at", sort_direction: "desc" },
      );
      const docs = r.documents ?? [];
      for (const d of docs) paths.push(d.file_path);
      if (docs.length < 100) break;
    }
    return paths;
  }

  /** 删除服务侧文档（含图谱实体/关系与向量）。LightRAG 删除是异步任务，返回时未必清完 */
  async deleteDoc(docId: string): Promise<void> {
    const doc = await this.findDoc(docId);
    if (!doc) return;
    await this.req("DELETE", "/documents/delete_document", {
      doc_ids: [doc.id],
      delete_llm_cache: true,
    });
  }

  /** 等服务侧文档真正消失（删除是异步的，期间 insert 同 file_source 会被 409 拒绝） */
  async waitDeleted(docId: string, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (!(await this.findDoc(docId))) return;
      if (Date.now() > deadline) throw new Error("lightrag 文档删除超时");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/** 产品档位 → LightRAG 底层检索模式；未指定时用纯检索默认值 */
export function modeFor(mode?: KbAskMode): string {
  if (mode === "quick") return QUICK_MODE;
  if (mode === "deep") return DEEP_MODE;
  return SEARCH_MODE;
}

/** file_source 直接取 docId：LightRAG 会把 "kb://" 这类 scheme 清洗掉，前缀约定不可靠 */
export function fileSource(docId: string): string {
  return docId;
}

/** chunk 的 file_path 即 kb_documents 的 docId（uuid）；非 kb 来源（手工上传等）返回 null */
export function parseDocId(filePath: string | undefined): string | null {
  if (filePath && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(filePath)) {
    return filePath;
  }
  return null;
}
