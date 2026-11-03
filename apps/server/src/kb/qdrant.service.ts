import { Injectable, Logger, OnModuleInit } from "@nestjs/common";

const QDRANT_URL = process.env.QDRANT_URL ?? "http://localhost:6333";

export interface ChunkPayload {
  doc_id: string;
  chunk_ix: number;
  user_id: string;
  doc_title: string;
  text: string;
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

  private collection(dim: number) {
    return `kb_chunks_d${dim}`;
  }

  private async ensureCollection(dim: number) {
    const name = this.collection(dim);
    const res = await fetch(`${QDRANT_URL}/collections/${name}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) return;
    const create = await fetch(`${QDRANT_URL}/collections/${name}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vectors: { size: dim, distance: "Cosine" } }),
      signal: AbortSignal.timeout(5000),
    });
    if (!create.ok) throw new Error(`create collection failed: ${await create.text()}`);
    this.log.log(`created collection ${name} (dim=${dim})`);
  }

  async upsert(points: { id: string; vector: number[]; payload: ChunkPayload }[]) {
    if (!points.length) return;
    const dim = points[0].vector.length;
    await this.ensureCollection(dim);
    const res = await fetch(
      `${QDRANT_URL}/collections/${this.collection(dim)}/points?wait=true`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ points }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) throw new Error(`upsert failed: ${await res.text()}`);
  }

  async search(vector: number[], userId: string, topK: number): Promise<SearchHit[]> {
    if (!this.ready) return [];
    const name = this.collection(vector.length);
    const exists = await fetch(`${QDRANT_URL}/collections/${name}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!exists.ok) return [];
    const res = await fetch(`${QDRANT_URL}/collections/${name}/points/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vector,
        limit: topK,
        with_payload: true,
        filter: { must: [{ key: "user_id", match: { value: userId } }] },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`search failed: ${await res.text()}`);
    const data = (await res.json()) as {
      result?: { score: number; payload: ChunkPayload }[];
    };
    return (data.result ?? []).map((r) => ({ score: r.score, payload: r.payload }));
  }

  /** 文档可能进过任一维度集合（本地/模型），按前缀全量清理 */
  async deleteByDoc(docId: string) {
    if (!this.ready) return;
    const res = await fetch(`${QDRANT_URL}/collections`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { result?: { collections?: { name: string }[] } };
    const names = (data.result?.collections ?? [])
      .map((c) => c.name)
      .filter((n) => n.startsWith("kb_chunks_d"));
    for (const name of names) {
      const del = await fetch(`${QDRANT_URL}/collections/${name}/points/delete?wait=true`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filter: { must: [{ key: "doc_id", match: { value: docId } }] },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!del.ok) this.log.warn(`delete points of doc ${docId} in ${name} failed: ${del.status}`);
    }
  }
}
