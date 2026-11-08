import { Inject, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { ModelDto, ModelKind, ModelTestResult } from "@aiwb/shared";
import { DB, type Db } from "../db/db.module";
import { models } from "../db/schema";
import { encrypt, decrypt } from "../common/crypto";
import { LlmAdapter } from "../llm/llm.adapter";

export interface UpsertModelInput {
  provider: string;
  modelName: string;
  endpoint: string;
  /** chat = 对话（推理），embedding = 向量；缺省 chat */
  kind?: ModelKind;
  apiKey?: string;
  /** 输入价格（分 / 1k tokens），0 = 未知 */
  priceIn?: number;
  /** 输出价格（分 / 1k tokens），0 = 未知 */
  priceOut?: number;
  priceNote?: string;
  /** 采样温度（可选）；编辑时传 null 表示清除覆盖、回到厂商默认 */
  temperature?: number | null;
  /** top_k 采样（可选）；同上，null = 清除 */
  topK?: number | null;
}

@Injectable()
export class ModelsService implements OnModuleInit {
  private readonly log = new Logger("models");

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly llm: LlmAdapter,
  ) {}

  async onModuleInit() {
    await this.ensureMockModel();
  }

  /** 确保 mock://mock-1 始终存在并标记 ok，让无 key 环境也能走完整链路 */
  private async ensureMockModel() {
    const [existing] = await this.db
      .select()
      .from(models)
      .where(eq(models.endpoint, "mock://mock-1"));

    if (existing) {
      if (existing.status !== "ok") {
        await this.db
          .update(models)
          .set({ status: "ok" })
          .where(eq(models.id, existing.id));
      }
      return;
    }

    await this.db.insert(models).values({
      id: randomUUID(),
      provider: "mock",
      modelName: "mock-1",
      endpoint: "mock://mock-1",
      kind: "chat",
      apiKeyEnc: null,
      status: "ok",
      isDefault: false,
      metaJson: { seeded: true, note: "内置 mock，无 key 可用" },
      createdAt: new Date(),
    });
    this.log.log("▸ 已创建 mock://mock-1 模型（开发/演示用）");
  }

  /** 挑选对话模型：指定 id 优先；否则用默认模型；再退到 status=ok 的第一个；最后任意已配置模型。
   *  preferReal=true 时跳过 mock:// 模型（用于意图路由等需要真实推理的场景）。
   *  从 ChatService 迁到此处，消除 KbModule → ChatModule 的循环依赖。 */
  async pickModel(modelId?: string, opts: { preferReal?: boolean } = {}) {
    const rows = await this.db.select().from(models);
    let pool = rows;
    if (opts.preferReal) pool = pool.filter((m) => !m.endpoint.startsWith("mock://"));
    const pick =
      (modelId ? pool.find((m) => m.id === modelId) : undefined) ??
      pool.find((m) => m.isDefault) ??
      pool.find((m) => m.status === "ok") ??
      pool[0];
    if (!pick) return null;
    const meta = (pick.metaJson as { temperature?: number | null; topK?: number | null } | null) ?? null;
    return {
      id: pick.id,
      modelName: pick.modelName,
      provider: pick.provider,
      endpoint: pick.endpoint,
      apiKey: pick.apiKeyEnc ? decrypt(pick.apiKeyEnc) : null,
      priceIn: pick.priceIn,
      priceOut: pick.priceOut,
      temperature: meta?.temperature,
      topK: meta?.topK,
    };
  }

  /** 返回所有状态 ok 且非 mock 的模型（带解密密钥），供路由等场景依次尝试 */
  async listRealModels() {
    const rows = await this.db.select().from(models);
    return rows
      .filter((m) => m.status === "ok" && !m.endpoint.startsWith("mock://"))
      .map((m) => {
        const meta = (m.metaJson as { temperature?: number | null } | null) ?? null;
        return {
          id: m.id,
          modelName: m.modelName,
          provider: m.provider,
          endpoint: m.endpoint,
          apiKey: m.apiKeyEnc ? decrypt(m.apiKeyEnc) : null,
          temperature: meta?.temperature,
        };
      });
  }

  toDto(m: typeof models.$inferSelect): ModelDto {
    return {
      id: m.id,
      provider: m.provider,
      modelName: m.modelName,
      endpoint: m.endpoint,
      kind: m.kind,
      hasKey: Boolean(m.apiKeyEnc),
      status: m.status,
      isDefault: m.isDefault,
      priceIn: m.priceIn,
      priceOut: m.priceOut,
      meta: (m.metaJson as ModelDto["meta"]) ?? null,
    };
  }

  async list(): Promise<ModelDto[]> {
    const rows = await this.db.select().from(models);
    return rows.map((m) => this.toDto(m));
  }

  async create(input: UpsertModelInput): Promise<ModelDto> {
    const meta: Record<string, unknown> = {};
    if (input.priceNote) meta.priceNote = input.priceNote;
    if (input.temperature !== undefined) meta.temperature = input.temperature;
    if (input.topK !== undefined) meta.topK = input.topK;

    const row: typeof models.$inferSelect = {
      id: randomUUID(),
      provider: input.provider,
      modelName: input.modelName,
      endpoint: input.endpoint,
      kind: input.kind ?? "chat",
      apiKeyEnc: input.apiKey ? encrypt(input.apiKey) : null,
      status: "untested",
      isDefault: false,
      priceIn: input.priceIn ?? 0,
      priceOut: input.priceOut ?? 0,
      metaJson: Object.keys(meta).length > 0 ? meta : null,
      createdAt: new Date(),
    };
    await this.db.insert(models).values(row);
    return this.toDto(row);
  }

  async update(id: string, input: Partial<UpsertModelInput>): Promise<ModelDto> {
    const [m] = await this.db.select().from(models).where(eq(models.id, id));
    if (!m) throw new NotFoundException("model not found");
    const patch: Partial<typeof models.$inferInsert> = {};
    if (input.provider !== undefined) patch.provider = input.provider;
    if (input.modelName !== undefined) patch.modelName = input.modelName;
    if (input.endpoint !== undefined) patch.endpoint = input.endpoint;
    if (input.kind !== undefined) patch.kind = input.kind;
    if (input.apiKey) patch.apiKeyEnc = encrypt(input.apiKey);
    if (input.priceIn !== undefined) patch.priceIn = input.priceIn;
    if (input.priceOut !== undefined) patch.priceOut = input.priceOut;
    if (
      input.priceNote !== undefined ||
      input.temperature !== undefined ||
      input.topK !== undefined
    ) {
      const meta = { ...((m.metaJson as object) ?? {}) } as Record<string, unknown>;
      if (input.priceNote !== undefined) meta.priceNote = input.priceNote;
      if (input.temperature !== undefined) meta.temperature = input.temperature;
      if (input.topK !== undefined) meta.topK = input.topK;
      patch.metaJson = meta;
    }
    await this.db.update(models).set(patch).where(eq(models.id, id));
    const [fresh] = await this.db.select().from(models).where(eq(models.id, id));
    return this.toDto(fresh);
  }

  async remove(id: string) {
    await this.db.delete(models).where(eq(models.id, id));
  }

  /** 设置全局默认模型：先清空其它模型的标记，再置顶目标（保证唯一） */
  async setDefault(id: string): Promise<ModelDto> {
    const [m] = await this.db.select().from(models).where(eq(models.id, id));
    if (!m) throw new NotFoundException("model not found");
    await this.db.update(models).set({ isDefault: false }).where(eq(models.isDefault, true));
    await this.db.update(models).set({ isDefault: true }).where(eq(models.id, id));
    return this.toDto({ ...m, isDefault: true });
  }

  /** 测试：对话模型走 chat，向量模型走 embed；结果回写状态灯与延迟 */
  async test(id: string, prompt?: string): Promise<ModelTestResult> {
    const [m] = await this.db.select().from(models).where(eq(models.id, id));
    if (!m) throw new NotFoundException("model not found");
    try {
      const apiKey = m.apiKeyEnc ? decrypt(m.apiKeyEnc) : null;
      if (m.kind === "embedding") {
        const started = Date.now();
        const vecs = await this.llm.embed({
          endpoint: m.endpoint,
          apiKey,
          model: m.modelName,
          texts: [prompt?.trim() || "ping"],
        });
        const latencyMs = Date.now() - started;
        const dim = vecs[0]?.length ?? 0;
        await this.writeResult(m, "ok", { latencyMs });
        return { ok: true, reply: `${vecs.length} 条向量 · ${dim} 维`, latencyMs };
      }
      const meta = (m.metaJson as { temperature?: number | null; topK?: number | null } | null) ?? null;
      const r = await this.llm.chat({
        endpoint: m.endpoint,
        apiKey,
        model: m.modelName,
        temperature: meta?.temperature,
        topK: meta?.topK,
        messages: [{ role: "user", content: prompt?.trim() || "Reply with the single word: pong" }],
      });
      await this.writeResult(m, "ok", { latencyMs: r.latencyMs });
      return { ok: true, reply: r.content, latencyMs: r.latencyMs };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.writeResult(m, "error", { lastError: msg });
      return { ok: false, error: msg, latencyMs: 0 };
    }
  }

  private async writeResult(
    m: typeof models.$inferSelect,
    status: "ok" | "error",
    extra: Record<string, unknown>,
  ) {
    await this.db
      .update(models)
      .set({
        status,
        metaJson: {
          ...((m.metaJson as object) ?? {}),
          ...extra,
          lastCheckedAt: Date.now(),
          ...(status === "ok" ? { lastError: undefined } : {}),
        },
      })
      .where(eq(models.id, m.id));
  }
}
