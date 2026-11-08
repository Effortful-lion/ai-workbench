import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  KbAskMode,
  KbAskResultDto,
  KbCreateFolderInput,
  KbDocumentDto,
  KbFolderDto,
  KbFolderNodeDto,
  KbFolderTreeDto,
  KbIngestInput,
  KbLinkDto,
  KbLinkInput,
  KbSearchHitDto,
  KbSearchResultDto,
  KbUpdateFolderInput,
} from "@aiwb/shared";
import { DB, type Db } from "../db/db.module";
import { kbDocuments, kbFolders, kbLinks } from "../db/schema";
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
      primaryFolderId: d.primaryFolderId,
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

  // ==================== 目录树（视图层） ====================

  /** 目录树 + 全部挂载关系。目录仅是视图容器：不持有文档本体、不向量化、不参与检索。 */
  async listFolders(userId: string): Promise<KbFolderTreeDto> {
    const [folderRows, linkRows] = await Promise.all([
      this.db
        .select()
        .from(kbFolders)
        .where(eq(kbFolders.ownerId, userId))
        .orderBy(asc(kbFolders.sortOrder), asc(kbFolders.createdAt)),
      this.db.select().from(kbLinks).where(eq(kbLinks.ownerId, userId)),
    ]);
    const nodes = new Map<string, KbFolderNodeDto>();
    for (const f of folderRows) {
      nodes.set(f.id, {
        id: f.id,
        parentId: f.parentId,
        name: f.name,
        sortOrder: f.sortOrder,
        docCount: 0,
        createdAt: f.createdAt.getTime(),
        children: [],
      });
    }
    for (const l of linkRows) {
      const n = nodes.get(l.folderId);
      if (n) n.docCount += 1;
    }
    const roots: KbFolderNodeDto[] = [];
    for (const f of folderRows) {
      const n = nodes.get(f.id);
      if (!n) continue;
      const parent = f.parentId ? nodes.get(f.parentId) : undefined;
      if (parent) parent.children.push(n);
      else roots.push(n);
    }
    return {
      folders: roots,
      links: linkRows.map((l) => ({
        id: l.id,
        documentId: l.documentId,
        folderId: l.folderId,
        createdAt: l.createdAt.getTime(),
      })),
    };
  }

  async createFolder(userId: string, input: KbCreateFolderInput): Promise<KbFolderDto> {
    const name = input.name.trim();
    if (!name) throw new Error("目录名不能为空");
    let parentId: string | null = null;
    if (input.parentId) {
      const [parent] = await this.db
        .select({ id: kbFolders.id })
        .from(kbFolders)
        .where(and(eq(kbFolders.id, input.parentId), eq(kbFolders.ownerId, userId)));
      if (!parent) throw new NotFoundException("parent folder not found");
      parentId = parent.id;
    }
    const [row] = await this.db
      .insert(kbFolders)
      .values({ id: randomUUID(), ownerId: userId, name, parentId, createdAt: new Date() })
      .returning();
    return {
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      sortOrder: row.sortOrder,
      docCount: 0,
      createdAt: row.createdAt.getTime(),
    };
  }

  /** 重命名 / 移动。移动做防环校验：目标不能是自身或自身子树中的目录。 */
  async updateFolder(userId: string, id: string, input: KbUpdateFolderInput): Promise<KbFolderDto> {
    const [row] = await this.db
      .select()
      .from(kbFolders)
      .where(and(eq(kbFolders.id, id), eq(kbFolders.ownerId, userId)));
    if (!row) throw new NotFoundException("folder not found");

    const patch: Partial<typeof kbFolders.$inferInsert> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new Error("目录名不能为空");
      patch.name = name;
    }
    if (input.parentId !== undefined) {
      if (input.parentId === null) {
        patch.parentId = null;
      } else {
        if (input.parentId === id) throw new Error("不能把目录移动到自身下");
        const subtree = await this.folderSubtreeIds(userId, id);
        if (subtree.has(input.parentId)) throw new Error("不能把目录移动到自己的子目录下");
        const [parent] = await this.db
          .select({ id: kbFolders.id })
          .from(kbFolders)
          .where(and(eq(kbFolders.id, input.parentId), eq(kbFolders.ownerId, userId)));
        if (!parent) throw new NotFoundException("parent folder not found");
        patch.parentId = input.parentId;
      }
    }
    if (Object.keys(patch).length) {
      await this.db.update(kbFolders).set(patch).where(eq(kbFolders.id, id));
    }
    const [fresh] = await this.db.select().from(kbFolders).where(eq(kbFolders.id, id));
    const links = await this.db
      .select({ documentId: kbLinks.documentId })
      .from(kbLinks)
      .where(and(eq(kbLinks.ownerId, userId), eq(kbLinks.folderId, id)));
    return {
      id: fresh.id,
      parentId: fresh.parentId,
      name: fresh.name,
      sortOrder: fresh.sortOrder,
      docCount: links.length,
      createdAt: fresh.createdAt.getTime(),
    };
  }

  /** 删除目录视图：删目录节点（子目录级联）+ 其下全部映射；文档本体与向量一律保留。 */
  async deleteFolder(
    userId: string,
    id: string,
  ): Promise<{ removedFolders: number; removedLinks: number }> {
    const [target] = await this.db
      .select({ id: kbFolders.id })
      .from(kbFolders)
      .where(and(eq(kbFolders.id, id), eq(kbFolders.ownerId, userId)));
    if (!target) throw new NotFoundException("folder not found");
    const ids = [...(await this.folderSubtreeIds(userId, id))];
    const linkRows = await this.db
      .select({ id: kbLinks.id })
      .from(kbLinks)
      .where(and(eq(kbLinks.ownerId, userId), inArray(kbLinks.folderId, ids)));
    await this.db
      .delete(kbLinks)
      .where(and(eq(kbLinks.ownerId, userId), inArray(kbLinks.folderId, ids)));
    // 主归属目录被删的文档退化为「未归类」，主归属虚拟路径展示字段保留原值
    await this.db
      .update(kbDocuments)
      .set({ primaryFolderId: null })
      .where(and(eq(kbDocuments.ownerId, userId), inArray(kbDocuments.primaryFolderId, ids)));
    await this.db
      .delete(kbFolders)
      .where(and(eq(kbFolders.ownerId, userId), inArray(kbFolders.id, ids)));
    return { removedFolders: ids.length, removedLinks: linkRows.length };
  }

  /** 目录 + 全部子目录 id 集合（含自身）。parentId 无外键，靠内存遍历。 */
  private async folderSubtreeIds(userId: string, folderId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ id: kbFolders.id, parentId: kbFolders.parentId })
      .from(kbFolders)
      .where(eq(kbFolders.ownerId, userId));
    const childrenOf = new Map<string, string[]>();
    for (const r of rows) {
      if (r.parentId) {
        const arr = childrenOf.get(r.parentId) ?? [];
        arr.push(r.id);
        childrenOf.set(r.parentId, arr);
      }
    }
    const ids = new Set<string>([folderId]);
    const queue = [folderId];
    while (queue.length) {
      const cur = queue.shift() as string;
      for (const c of childrenOf.get(cur) ?? []) {
        if (!ids.has(c)) {
          ids.add(c);
          queue.push(c);
        }
      }
    }
    return ids;
  }

  /** 目录链（根→自身）的名字序列；目录不存在时返回 null。移动操作的防环校验保证无死循环。 */
  private async folderChain(userId: string, folderId: string): Promise<string[] | null> {
    const rows = await this.db
      .select({ id: kbFolders.id, name: kbFolders.name, parentId: kbFolders.parentId })
      .from(kbFolders)
      .where(eq(kbFolders.ownerId, userId));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const chain: string[] = [];
    const visited = new Set<string>();
    let cur = byId.get(folderId);
    while (cur && !visited.has(cur.id)) {
      visited.add(cur.id);
      chain.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return chain.length ? chain : null;
  }

  // ==================== 软链接（挂载 / 移除） ====================

  /** 挂载：一份文档可挂多个目录，唯一约束防重复；不复制本体、不重复切片。 */
  async mountDocument(userId: string, input: KbLinkInput): Promise<KbLinkDto> {
    const [doc] = await this.db
      .select({ id: kbDocuments.id })
      .from(kbDocuments)
      .where(and(eq(kbDocuments.id, input.documentId), eq(kbDocuments.ownerId, userId)));
    if (!doc) throw new NotFoundException("document not found");
    const [folder] = await this.db
      .select({ id: kbFolders.id })
      .from(kbFolders)
      .where(and(eq(kbFolders.id, input.folderId), eq(kbFolders.ownerId, userId)));
    if (!folder) throw new NotFoundException("folder not found");
    await this.db
      .insert(kbLinks)
      .values({
        id: randomUUID(),
        ownerId: userId,
        documentId: input.documentId,
        folderId: input.folderId,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
    const [row] = await this.db
      .select()
      .from(kbLinks)
      .where(and(eq(kbLinks.documentId, input.documentId), eq(kbLinks.folderId, input.folderId)));
    return {
      id: row.id,
      documentId: row.documentId,
      folderId: row.folderId,
      createdAt: row.createdAt.getTime(),
    };
  }

  /** 移除链接：仅删映射行。文档本体、向量切片、其他目录视图全部保留，全局检索仍可命中。 */
  async unlink(userId: string, linkId: string): Promise<void> {
    const res = await this.db
      .delete(kbLinks)
      .where(and(eq(kbLinks.id, linkId), eq(kbLinks.ownerId, userId)))
      .returning({ id: kbLinks.id });
    if (!res.length) throw new NotFoundException("link not found");
  }

  /** 目录范围 → doc_id 集合：子树内全部挂载的文档（只看映射表，与主归属无关）。 */
  private async scopeDocIds(userId: string, folderId: string): Promise<string[]> {
    const subtree = await this.folderSubtreeIds(userId, folderId);
    const rows = await this.db
      .select({ documentId: kbLinks.documentId })
      .from(kbLinks)
      .where(and(eq(kbLinks.ownerId, userId), inArray(kbLinks.folderId, [...subtree])));
    return [...new Set(rows.map((r) => r.documentId))];
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

    // 主归属目录（可选）：写入 chunk primary_path 做路径语义增强；额外挂载不覆盖它
    let primaryFolderId: string | null = null;
    let primaryPath = `~/kb/${title}`;
    if (input.folderId) {
      const chain = await this.folderChain(userId, input.folderId);
      if (!chain) throw new Error("主归属目录不存在");
      primaryFolderId = input.folderId;
      primaryPath = `~/kb/${[...chain, title].join("/")}`;
    }

    const id = randomUUID();
    const row: typeof kbDocuments.$inferSelect = {
      id,
      ownerId: userId,
      title,
      path: primaryPath,
      primaryFolderId,
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
    void this.processDocument(id, userId, title, content, primaryPath).catch((e) => {
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
    void this.processDocument(id, userId, doc.title, content, doc.path).catch((e) => {
      this.log.warn(`processDocument ${id} unexpected: ${(e as Error).message}`);
    });
    return this.toDto({ ...doc, status: "pending", error: null });
  }

  /** 后台处理：切分 + embedding / LightRAG 图谱抽取，完成后翻转状态。
   *  primaryPath 写入 Qdrant payload.primary_path（路径语义增强；LightRAG 链路不写）。 */
  private async processDocument(
    id: string,
    userId: string,
    title: string,
    content: string,
    primaryPath = `~/kb/${title}`,
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
            payload: {
              doc_id: id,
              chunk_ix: ix,
              user_id: userId,
              doc_title: title,
              text,
              primary_path: primaryPath,
            },
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

  /** 双模式检索：
   *  ① 全局（folderId 缺省）：全部扁平文档直接召回，与纯扁平方案行为一致；
   *  ② 目录范围（folderId 传入）：映射表取子树 doc_id 集合 → 向量库 metadata 过滤召回。
   *  LightRAG 链路不支持 metadata 过滤，只能全局召回后应用层过滤（scopeFiltered 标记）。 */
  async search(
    userId: string,
    query: string,
    topK = 5,
    folderId?: string,
  ): Promise<KbSearchResultDto> {
    const started = Date.now();
    const q = query.trim();
    if (!q) return { query, hits: [], embedding: "local", latencyMs: 0 };

    const docIds = folderId ? await this.scopeDocIds(userId, folderId) : undefined;

    if (this.useLightRag()) {
      const limit = Math.min(Math.max(topK, 1), 20);
      const chunks = await this.lightrag.queryData(q, limit);
      let hits = await this.chunksToHits(userId, chunks, limit);
      const scopeFiltered = !!docIds;
      if (docIds) {
        const allow = new Set(docIds);
        hits = hits.filter((h) => allow.has(h.docId));
      }
      return {
        query,
        hits,
        embedding: "model",
        latencyMs: Date.now() - started,
        scopeFiltered,
      };
    }

    const { vectors, source } = await this.embed.embed([q]);
    const hits = await this.qdrant.search(
      vectors[0],
      userId,
      Math.min(Math.max(topK, 1), 20),
      docIds,
    );
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
        primaryPath: h.payload.primary_path,
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
   *  mode：quick=仅向量直取（快，单点事实）/ deep=图谱+向量（慢，跨文档推理）
   *  modelId：指定生成模型，缺省=服务端默认（pickModel 优先级：指定 → 默认 → 首个 ok） */
  async ask(
    userId: string,
    query: string,
    topK = 5,
    mode: KbAskMode = "deep",
    modelId?: string,
  ): Promise<KbAskResultDto> {
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

    const model = await this.models.pickModel(modelId);
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
    // 删除文档本体：清除所有目录视图中的映射记录（文档在所有目录中消失）
    await this.db
      .delete(kbLinks)
      .where(and(eq(kbLinks.ownerId, userId), eq(kbLinks.documentId, id)));
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
