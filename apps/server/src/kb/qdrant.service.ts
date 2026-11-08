import { Injectable, Logger, OnModuleInit } from "@nestjs/common";

const QDRANT_URL = process.env.QDRANT_URL ?? "http://localhost:6333";
/** Qdrant 不可达时给出的可操作提示（写入文档 error 字段，前端直接展示） */
const QDRANT_HINT = `向量库 Qdrant 不可达（${QDRANT_URL}）：请先启动 Qdrant 容器，或用 KB_PROVIDER=lightrag 切换图谱检索`;

export interface ChunkPayload {
  doc_id: string;
  chunk_ix: number;
  user_id: string;
  doc_title: string;
  text: string;
  /** 主归属虚拟路径（路径语义增强，可空=存量文档未回填） */
  primary_path?: string;
}

export interface SearchHit {
  score: number;
  payload: ChunkPayload;
}

/** Qdrant 单节点封装（REST）。集合按向量维度分名 kb_chunks_d<dim>，
 *  避免本地向量与真实模型向量维度冲突；payload 带 user_id 实现按用户隔离。 */
@Injectable()
export class QdrantService implements OnModuleInit {
  private readonly log = new Logger("kb:qdrant");
  private ready = false;

  async onModuleInit() {
    try {
      const res = await fetch(`${QDRANT_URL}/collections`, {
        signal: AbortSignal.timeout(3000),
      });
      this.ready = res.ok;
    } catch {
      this.ready = false;
    }
    if (!this.ready) this.log.warn(`Qdrant 不可达（${QDRANT_URL}），kb 检索将返回空结果`);
  }

  available() {
    return this.ready;
  }

  /** 统一出口：把网络层错误（fetch failed / 超时）翻译成可读提示 */
  private async req(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
    try {
      return await fetch(`${QDRANT_URL}${path}`, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new Error(`${QDRANT_HINT}（请求超时）`);
      }
      throw new Error(QDRANT_HINT);
    }
  }

  private collection(dim: number) {
    return `kb_chunks_d${dim}`;
  }

  private async ensureCollection(dim: number) {
    const name = this.collection(dim);
    const res = await this.req(`/collections/${name}`, {}, 3000);
    if (res.ok) return;
    const create = await this.req(
      `/collections/${name}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vectors: { size: dim, distance: "Cosine" } }),
      },
      5000,
    );
    if (!create.ok) throw new Error(`create collection failed: ${await create.text()}`);
    this.log.log(`created collection ${name} (dim=${dim})`);
  }

  async upsert(points: { id: string; vector: number[]; payload: ChunkPayload }[]) {
    if (!points.length) return;
    const dim = points[0].vector.length;
    await this.ensureCollection(dim);
    const res = await this.req(
      `/collections/${this.collection(dim)}/points?wait=true`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ points }),
      },
      15_000,
    );
    if (!res.ok) throw new Error(`upsert failed: ${await res.text()}`);
  }

  /** 扁平向量召回：user_id 隔离必选；docIds 传入时作为目录范围过滤（match any）。
   *  docIds 为空数组表示该范围内无文档，直接返回空结果。 */
  async search(
    vector: number[],
    userId: string,
    topK: number,
    docIds?: string[],
  ): Promise<SearchHit[]> {
    if (!this.ready) return [];
    if (docIds && docIds.length === 0) return [];
    const name = this.collection(vector.length);
    const exists = await this.req(`/collections/${name}`, {}, 3000);
    if (!exists.ok) return [];
    const must: unknown[] = [{ key: "user_id", match: { value: userId } }];
    if (docIds?.length) must.push({ key: "doc_id", match: { any: docIds } });
    const res = await this.req(
      `/collections/${name}/points/search`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vector,
          limit: topK,
          with_payload: true,
          filter: { must },
        }),
      },
      10_000,
    );
    if (!res.ok) throw new Error(`search failed: ${await res.text()}`);
    const data = (await res.json()) as {
      result?: { score: number; payload: ChunkPayload }[];
    };
    return (data.result ?? []).map((r) => ({ score: r.score, payload: r.payload }));
  }

  /** 文档可能进过任一维度集合（本地/模型），按前缀全量清理 */
  async deleteByDoc(docId: string) {
    if (!this.ready) return;
    const res = await this.req("/collections", {}, 3000);
    if (!res.ok) return;
    const data = (await res.json()) as { result?: { collections?: { name: string }[] } };
    const names = (data.result?.collections ?? [])
      .map((c) => c.name)
      .filter((n) => n.startsWith("kb_chunks_d"));
    for (const name of names) {
      const del = await this.req(
        `/collections/${name}/points/delete?wait=true`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filter: { must: [{ key: "doc_id", match: { value: docId } }] },
          }),
        },
        10_000,
      );
      if (!del.ok) this.log.warn(`delete points of doc ${docId} in ${name} failed: ${del.status}`);
    }
  }
}
