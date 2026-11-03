import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  KbAskResultDto,
  KbDocumentDto,
  KbIngestInput,
  KbSearchHitDto,
  KbSearchResultDto,
} from "@aiwb/shared";
import { DB, type Db } from "../db/db.module";
import { kbDocuments } from "../db/schema";
import { ChatService } from "../chat/chat.service";
import { LlmAdapter } from "../llm/llm.adapter";
import { EmbeddingService } from "./embedding.service";
import { QdrantService } from "./qdrant.service";

/** 切分参数：~500 字滑窗，重叠 100 字 */
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 100;
const MAX_DOC_CHARS = 200_000;

/** workspace root — __dirname = dist/kb，往上 4 级 */
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
    private readonly chat: ChatService,
    private readonly llm: LlmAdapter,
  ) {}

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

  /** 摄入：落库 → 存原文 → 切分 → embedding → 写入 Qdrant */
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
      mime: input.mime ?? "text/plain",
      size: Buffer.byteLength(content, "utf8"),
      status: "pending",
      chunkCount: 0,
      error: null,
      createdAt: new Date(),
    };
    await this.db.insert(kbDocuments).values(row);

    try {
      // 原文存档（可追溯/重新 embedding）
      const dir = join(UPLOAD_DIR, userId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${id}.txt`), content, "utf8");

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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn(`ingest ${title} failed: ${msg}`);
      await this.db
        .update(kbDocuments)
        .set({ status: "error", error: msg })
        .where(eq(kbDocuments.id, id));
    }
    const [fresh] = await this.db.select().from(kbDocuments).where(eq(kbDocuments.id, id));
    return this.toDto(fresh);
  }

  async search(userId: string, query: string, topK = 5): Promise<KbSearchResultDto> {
    const started = Date.now();
    const q = query.trim();
    if (!q) return { query, hits: [], embedding: "local", latencyMs: 0 };
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

  /** 检索即对话：先检索片段，再交给对话模型生成带引用的答案；无真实模型时降级抽取式摘要 */
  async ask(userId: string, query: string, topK = 5): Promise<KbAskResultDto> {
    const started = Date.now();
    const q = query.trim();
    const r = await this.search(userId, q, topK);
    const base = { query: q, citations: r.hits, embedding: r.embedding };

    if (!r.hits.length) {
      return {
        ...base,
        answer: "知识库中没有检索到相关内容。先上传文档，或换一种说法再试。",
        source: "extractive",
        latencyMs: Date.now() - started,
      };
    }

    const model = await this.chat.pickModel();
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
    await this.qdrant.deleteByDoc(id);
    await this.db.delete(kbDocuments).where(eq(kbDocuments.id, id));
    await rm(join(UPLOAD_DIR, userId, `${id}.txt`), { force: true });
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
