import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  KbAskMode,
  KbAskResultDto,
  KbDocumentDto,
  KbIngestInput,
  KbSearchHitDto,
  KbSearchResultDto,
} from "@aiwb/shared";
import { DB, type Db } from "../db/db.module";
import { kbDocuments } from "../db/schema";
import { ModelsService } from "../models/models.service";
import { LlmAdapter } from "../llm/llm.adapter";
import { EmbeddingService } from "./embedding.service";
import { LightRagService, parseDocId, type LightRagChunk } from "./lightrag.service";
import { QdrantService } from "./qdrant.service";
import { StorageService } from "../storage/storage.service";

/** 切分参数：~500 字滑窗，重叠 100 字 */
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 100;
const MAX_DOC_CHARS = 200_000;

/** 检索层提供者：qdrant=自研向量检索（默认） / lightrag=独立图谱 RAG 服务 */
const KB_PROVIDER = process.env.KB_PROVIDER ?? "qdrant";

/** workspace root — __dirname = dist/kb，往上 4 级。
 *  遗留本地存档目录：迁移期兜底读取用；新文档一律写 MinIO（BUCKETS.kb） */
const UPLOAD_DIR = join(resolve(__dirname, "../../../../data"), "uploads");

/** 检索即对话的系统提示：只依据资料作答，缺失时明确说不知道 */
const ASK_SYSTEM_PROMPT = `你是知识库问答助手。严格依据用户提供的资料回答，不要编造。
回答末尾用 [1][2] 标注所依据的资料编号；资料不足以回答时，直说「知识库中没有足够信息」。`;

@Injectable()
export class KbService {
  private readonly log = new Logger("kb");

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly embed: EmbeddingService,
    private readonly qdrant: QdrantService,
    private readonly lightrag: LightRagService,
    private readonly models: ModelsService,
    private readonly llm: LlmAdapter,
    private readonly storage: StorageService,
  ) {}

  /** 原文在 MinIO 的 object key：<userId>/<docId>.txt（由 DB 行可推导，无需新增列） */
  private archiveKey(userId: string, id: string): string {
    return `${userId}/${id}.txt`;
  }

  /** 是否走 LightRAG 图谱检索层 */
  private useLightRag() {
    return KB_PROVIDER === "lightrag" && this.lightrag.available();
  }

  private toDto(d: typeof kbDocuments.$inferSelect): KbDocumentDto {
    return {
      id: d.id,
      title: d.title,
      path: d.path,
      mime: d.mime,
      size: d.size,
      status: d.status,
      chunkCount: d.chunkCount,
      error: d.error,
      createdAt: d.createdAt.getTime(),
    };
  }

  async listDocuments(userId: string): Promise<KbDocumentDto[]> {
    const rows = await this.db
      .select()
      .from(kbDocuments)
      .where(eq(kbDocuments.ownerId, userId))
      .orderBy(desc(kbDocuments.createdAt));
    return rows.map((d) => this.toDto(d));
  }

  /** 摄入（异步）：落库 pending 行 + 存档原文后立即返回，切分/向量化在后台执行。
   *  状态翻转：pending → embedded / error；超时由 lightrag.waitProcessed 上限兜底（默认 10 分钟）。 */
  async ingest(userId: string, input: KbIngestInput): Promise<KbDocumentDto> {
    const title = input.title.trim();
    const content = input.content.replace(/\r\n/g, "\n").trim();
    if (!title) throw new Error("标题不能为空");
    if (!content) throw new Error("内容为空（一期仅支持纯文本类文档）");
    if (content.length > MAX_DOC_CHARS) {
      throw new Error(`文档过长（>${MAX_DOC_CHARS} 字符），请拆分后上传`);
    }

    const id = randomUUID();
    const row: typeof kbDocuments.$inferSelect = {
      id,
      ownerId: userId,
      title,
      path: `~/kb/${title}`,
      primaryFolderId: null,
      mime: input.mime ?? "text/plain",
      size: Buffer.byteLength(content, "utf8"),
      status: "pending",
      chunkCount: 0,
      error: null,
      createdAt: new Date(),
    };
    await this.db.insert(kbDocuments).values(row);

    try {
      // 原文存档到 MinIO（可追溯/重新 embedding）；存档失败直接抛错，不进后台
      await this.storage.putObject(
        "kb",
        this.archiveKey(userId, id),
        Buffer.from(content, "utf8"),
        "text/plain; charset=utf-8",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.db
        .update(kbDocuments)
        .set({ status: "error", error: msg })
        .where(eq(kbDocuments.id, id));
      throw e;
    }

    // 后台处理：不阻塞接口响应；异常落入 error 状态，由前端轮询感知
    void this.processDocument(id, userId, title, content).catch((e) => {
      this.log.warn(`processDocument ${id} unexpected: ${(e as Error).message}`);
    });
    return this.toDto(row);
  }

  /** 重新索引：读取归档原文重跑后台处理；pending 中文档拒绝（避免重复入队） */
  async retryIngest(id: string, userId: string): Promise<KbDocumentDto> {
    const [doc] = await this.db
      .select()
      .from(kbDocuments)
      .where(and(eq(kbDocuments.id, id), eq(kbDocuments.ownerId, userId)));
    if (!doc) throw new NotFoundException("document not found");
    if (doc.status === "pending") throw new Error("文档正在处理中，无需重试");
    const content = await this.readArchive(userId, id);
    // LightRAG 对相同 file_source 拒绝重复 insert（409），重建前需先删服务侧旧文档并等其清完
    if (this.useLightRag()) {
      await this.lightrag.deleteDoc(id).catch((e) => {
        this.log.warn(`lightrag delete before retry ${id} failed: ${(e as Error).message}`);
      });
      await this.lightrag.waitDeleted(id);
      this.lightrag.clearCache();
    }
    await this.db
      .update(kbDocuments)
      .set({ status: "pending", error: null })
      .where(eq(kbDocuments.id, id));
    void this.processDocument(id, userId, doc.title, content).catch((e) => {
      this.log.warn(`processDocument ${id} unexpected: ${(e as Error).message}`);
    });
    return this.toDto({ ...doc, status: "pending", error: null });
  }

  /** 后台处理：切分 + embedding / LightRAG 图谱抽取，完成后翻转状态 */
  private async processDocument(
    id: string,
    userId: string,
    title: string,
    content: string,
  ): Promise<void> {
    try {
      if (this.useLightRag()) {
        // LightRAG 侧异步完成切分/图谱抽取/向量化，轮询至处理完毕
        await this.lightrag.insertText(id, content);
        const { chunks } = await this.lightrag.waitProcessed(id);
        // 新语料已可检索，旧的问答/检索缓存作废
        this.lightrag.clearCache();
        await this.db
          .update(kbDocuments)
          .set({ status: "embedded", chunkCount: chunks })
          .where(eq(kbDocuments.id, id));
      } else {
        const chunks = chunkText(content);
        const { vectors } = await this.embed.embed(chunks);
        await this.qdrant.upsert(
          chunks.map((text, ix) => ({
            id: randomUUID(),
            vector: vectors[ix],
            payload: { doc_id: id, chunk_ix: ix, user_id: userId, doc_title: title, text },
          })),
        );
        await this.db
          .update(kbDocuments)
          .set({ status: "embedded", chunkCount: chunks.length })
          .where(eq(kbDocuments.id, id));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn(`ingest ${title} failed: ${msg}`);
      await this.db
        .update(kbDocuments)
        .set({ status: "error", error: msg })
        .where(eq(kbDocuments.id, id));
    }
  }

  async search(userId: string, query: string, topK = 5): Promise<KbSearchResultDto> {
    const started = Date.now();
    const q = query.trim();
    if (!q) return { query, hits: [], embedding: "local", latencyMs: 0 };

    if (this.useLightRag()) {
      const limit = Math.min(Math.max(topK, 1), 20);
      const chunks = await this.lightrag.queryData(q, limit);
      const hits = await this.chunksToHits(userId, chunks, limit);
      return { query, hits, embedding: "model", latencyMs: Date.now() - started };
    }

    const { vectors, source } = await this.embed.embed([q]);
    const hits = await this.qdrant.search(vectors[0], userId, Math.min(Math.max(topK, 1), 20));
    return {
      query,
      embedding: source,
      latencyMs: Date.now() - started,
      hits: hits.map((h) => ({
        docId: h.payload.doc_id,
        docTitle: h.payload.doc_title,
        chunkIx: h.payload.chunk_ix,
        score: Math.round(h.score * 1000) / 1000,
        text: h.payload.text,
      })),
    };
  }

  /** LightRAG chunks → 检索命中，按用户隔离过滤并回填标题。
   *  LightRAG workspace 是共享空间，他人文档片段在此直接丢弃。 */
  private async chunksToHits(
    userId: string,
    chunks: LightRagChunk[],
    limit: number,
  ): Promise<KbSearchHitDto[]> {
    const titles = await this.titlesByIds(
      userId,
      [...new Set(chunks.map((c) => parseDocId(c.file_path)).filter((x): x is string => !!x))],
    );
    const hits: KbSearchHitDto[] = [];
    for (const c of chunks) {
      const docId = parseDocId(c.file_path);
      const title = docId ? titles.get(docId) : undefined;
      if (!docId || !title) continue;
      hits.push({
        docId,
        docTitle: title,
        chunkIx: Number(c.reference_id) || 0,
        // LightRAG 不返回相似度，按返回顺序合成递减值，仅用于展示排序
        score: Math.round((1 - hits.length * 0.05) * 1000) / 1000,
        text: c.content,
      });
      if (hits.length >= limit) break;
    }
    return hits;
  }

  /** docId → title 映射（仅本人文档），用于 LightRAG 检索结果回填与隔离过滤 */
  private async titlesByIds(userId: string, ids: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!ids.length) return map;
    const rows = await this.db
      .select({ id: kbDocuments.id, title: kbDocuments.title })
      .from(kbDocuments)
      .where(eq(kbDocuments.ownerId, userId));
    for (const r of rows) if (ids.includes(r.id)) map.set(r.id, r.title);
    return map;
  }

  /** 检索即对话：先检索片段，再交给对话模型生成带引用的答案；无真实模型时降级抽取式摘要。
   *  mode：quick=仅向量直取（快，单点事实）/ deep=图谱+向量（慢，跨文档推理） */
  async ask(userId: string, query: string, topK = 5, mode: KbAskMode = "deep"): Promise<KbAskResultDto> {
    const started = Date.now();
    const q = query.trim();
    const depth: KbAskMode = mode === "quick" ? "quick" : "deep";

    // LightRAG 路径：生成式答案由图谱 RAG 服务产出；并行取结构化 chunk 回填 citations
    if (this.useLightRag()) {
      const limit = Math.min(Math.max(topK, 1), 20);
      const [answer, chunks] = await Promise.all([
        this.lightrag.query(q, depth),
        this.lightrag.queryData(q, limit, depth).catch((e) => {
          this.log.warn(`lightrag citations failed: ${(e as Error).message}`);
          return [] as LightRagChunk[];
        }),
      ]);
      const citations = await this.chunksToHits(userId, chunks, limit);
      if (answer) {
        return {
          query: q,
          answer,
          citations,
          embedding: "model",
          source: "llm",
          model: "lightrag",
          mode: depth,
          latencyMs: Date.now() - started,
        };
      }
      // 生成失败但有检索结果：退化为抽取式，至少让用户看到原文依据
      if (citations.length) {
        return {
          query: q,
          answer: extractiveAnswer(q, citations),
          citations,
          embedding: "model",
          source: "extractive",
          mode: depth,
          latencyMs: Date.now() - started,
        };
      }
      return {
        query: q,
        answer: "知识库服务暂时不可用，请稍后再试。",
        citations: [],
        embedding: "model",
        source: "extractive",
        mode: depth,
        latencyMs: Date.now() - started,
      };
    }

    const r = await this.search(userId, q, topK);
    const base = { query: q, citations: r.hits, embedding: r.embedding, mode: depth };

    if (!r.hits.length) {
      return {
        ...base,
        answer: "知识库中没有检索到相关内容。先上传文档，或换一种说法再试。",
        source: "extractive",
        latencyMs: Date.now() - started,
      };
    }

    const model = await this.models.pickModel();
    if (model && !model.endpoint.startsWith("mock://")) {
      try {
        const answer = await this.llm.chat({
          endpoint: model.endpoint,
          apiKey: model.apiKey,
          model: model.modelName,
          temperature: model.temperature,
          topK: model.topK,
          messages: [
            { role: "system", content: ASK_SYSTEM_PROMPT },
            { role: "user", content: buildAskPrompt(q, r.hits) },
          ],
          timeoutMs: 45_000,
        });
        const text = answer.content.trim();
        if (text) {
          return {
            ...base,
            answer: text,
            source: "llm",
            model: model.modelName,
            latencyMs: Date.now() - started,
          };
        }
      } catch (e) {
        this.log.warn(`ask failed, fallback to extractive: ${(e as Error).message}`);
      }
    }

    return {
      ...base,
      answer: extractiveAnswer(q, r.hits),
      source: "extractive",
      latencyMs: Date.now() - started,
    };
  }

  async removeDocument(id: string, userId: string) {
    const [doc] = await this.db
      .select()
      .from(kbDocuments)
      .where(and(eq(kbDocuments.id, id), eq(kbDocuments.ownerId, userId)));
    if (!doc) throw new NotFoundException("document not found");
    if (this.useLightRag()) {
      await this.lightrag.deleteDoc(id).catch((e) => {
        this.log.warn(`lightrag delete doc ${id} failed: ${(e as Error).message}`);
      });
      this.lightrag.clearCache();
    } else {
      await this.qdrant.deleteByDoc(id);
    }
    await this.db.delete(kbDocuments).where(eq(kbDocuments.id, id));
    // MinIO 原文与遗留本地存档都清一遍（迁移期两种都可能存在）
    await this.storage
      .removeObject("kb", this.archiveKey(userId, id))
      .catch(() => {});
    await rm(join(UPLOAD_DIR, userId, `${id}.txt`), { force: true });
  }

  /** 读原文：优先 MinIO，遗留本地文件兜底（未跑迁移脚本的老文档） */
  private async readArchive(userId: string, id: string): Promise<string> {
    try {
      const buf = await this.storage.getObjectBuffer("kb", this.archiveKey(userId, id));
      return buf.toString("utf8");
    } catch {
      return readFile(join(UPLOAD_DIR, userId, `${id}.txt`), "utf8");
    }
  }

  /** 只读原文：供 Agent / 用户读取知识库文档正文（不重新 embedding） */
  async readOriginal(userId: string, id: string) {
    const [doc] = await this.db
      .select()
      .from(kbDocuments)
      .where(and(eq(kbDocuments.id, id), eq(kbDocuments.ownerId, userId)));
    if (!doc) throw new NotFoundException("document not found");
    const content = await this.readArchive(userId, id);
    return { id: doc.id, title: doc.title, status: doc.status, content, createdAt: doc.createdAt };
  }
}

/** 组装 RAG 提示：编号片段 + 问题 */
function buildAskPrompt(query: string, hits: KbSearchHitDto[]): string {
  const context = hits
    .map((h, i) => `[${i + 1}] 《${h.docTitle}》 片段 #${h.chunkIx}（相关度 ${h.score}）\n${h.text}`)
    .join("\n\n");
  return `资料：\n${context}\n\n问题：${query}`;
}

/** 无真实对话模型时的降级答案：抽取 top 片段做摘要，保留 [n] 引用 */
function extractiveAnswer(query: string, hits: KbSearchHitDto[]): string {
  const picked = hits.slice(0, 3).map((h, i) => {
    const text = h.text.replace(/\s+/g, " ").slice(0, 220);
    return `[${i + 1}] 《${h.docTitle}》：${text}${h.text.length > 220 ? "…" : ""}`;
  });
  return [
    `关于「${query}」，知识库中找到 ${hits.length} 个相关片段：`,
    "",
    ...picked,
    "",
    "（当前为本地抽取式回答；接入真实对话模型后将生成总结性答案）",
  ].join("\n");
}

/** ~500 字滑窗切分，重叠 100 字；优先在段落/句号处断开 */
export function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_SIZE, text.length);
    if (end < text.length) {
      // 在窗口尾部找自然断点（换行/句号/分号）
      const window = text.slice(start, end);
      const brk = Math.max(
        window.lastIndexOf("\n"),
        window.lastIndexOf("。"),
        window.lastIndexOf("；"),
      );
      if (brk > CHUNK_SIZE / 2) end = start + brk + 1;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= text.length) break;
    start = end - CHUNK_OVERLAP;
    if (start < 0) start = 0;
  }
  return chunks;
}
