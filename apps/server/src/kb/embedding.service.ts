import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { like } from "drizzle-orm";
import { DB, type Db } from "../db/db.module";
import { models } from "../db/schema";
import { decrypt } from "../common/crypto";
import { LlmAdapter } from "../llm/llm.adapter";

/** 本地确定性向量维度（无 embedding 模型时的降级方案） */
export const LOCAL_DIM = 256;

export interface EmbedResult {
  vectors: number[][];
  source: "model" | "local";
  dim: number;
}

/** Embedding 服务：优先复用模型管理里名称含 embed 的模型（OpenAI 兼容 /embeddings）；
 *  无可用模型时降级「特征哈希」本地确定性向量——对中文按字 + 二元组、英文按词做散列，
 *  余弦相似度与共享词面相关，无 key 的本地开发也能演示可用的检索。 */
@Injectable()
export class EmbeddingService {
  private readonly log = new Logger("kb:embed");

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly llm: LlmAdapter,
  ) {}

  async embed(texts: string[]): Promise<EmbedResult> {
    const model = await this.pickEmbeddingModel();
    if (model) {
      try {
        const vectors = await this.llm.embed({
          endpoint: model.endpoint,
          apiKey: model.apiKey,
          model: model.modelName,
          texts,
        });
        if (vectors.length === texts.length && vectors[0]?.length) {
          return { vectors, source: "model", dim: vectors[0].length };
        }
        throw new Error("empty embeddings");
      } catch (e) {
        this.log.warn(`model embedding failed, fallback to local: ${(e as Error).message}`);
      }
    }
    return { vectors: texts.map((t) => localEmbed(t)), source: "local", dim: LOCAL_DIM };
  }

  private async pickEmbeddingModel() {
    const rows = await this.db
      .select()
      .from(models)
      .where(like(models.modelName, "%embed%"));
    const pick = rows.find((m) => !m.endpoint.startsWith("mock://"));
    if (!pick) return null;
    return {
      modelName: pick.modelName,
      endpoint: pick.endpoint,
      apiKey: pick.apiKeyEnc ? decrypt(pick.apiKeyEnc) : null,
    };
  }
}

/** 特征哈希向量：字符二元组 + ASCII 词 → 散列到 dim 维，L2 归一化（确定性） */
export function localEmbed(text: string, dim = LOCAL_DIM): number[] {
  const v = new Array<number>(dim).fill(0);
  const add = (token: string, weight: number) => {
    const h = createHash("sha256").update(token).digest();
    const ix = h.readUInt32BE(0) % dim;
    const sign = h[4] & 1 ? 1 : -1; // 带符号哈希，减少碰撞伪相关
    v[ix] += weight * sign;
  };
  const compact = text.replace(/\s+/g, " ").trim();
  // 中文字符单字 + 二元组
  const chars = [...compact].filter((c) => /[一-鿿]/.test(c));
  for (let i = 0; i < chars.length; i++) {
    add(`c:${chars[i]}`, 0.6);
    if (i + 1 < chars.length) add(`b:${chars[i]}${chars[i + 1]}`, 1);
  }
  // ASCII 词
  for (const w of compact.toLowerCase().match(/[a-z0-9_.-]{2,}/g) ?? []) {
    add(`w:${w}`, 1);
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}
