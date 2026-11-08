import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { LlmAdapter, type ChatMessage } from "../llm/llm.adapter";
import { ModelsService } from "../models/models.service";
import { LightRagService } from "../kb/lightrag.service";
import { buildCapabilityDocs, moduleDigest } from "../tools/site.tools";

/** 系统级能力文档在 LightRAG 中的 doc_id 前缀，与用户文档隔离，不进 kb_documents 表（避免用户 FK） */
const CAPABILITY_DOC_PREFIX = "capability:";

/** 路由失败模型的短期跳过 TTL：避免每轮都先试欠费/不可用模型拖慢首字延迟 */
const ROUTE_FAIL_TTL_MS = 5 * 60 * 1000;
const failedModels = new Map<string, number>(); // modelId → fail timestamp

/** 意图路由的返回：general = 全站概览类问题（不下发业务工具，靠能力 KB 回答）；
 *  specific = 已锁定到若干模块，只下发这些模块的工具 */
export type RouteResult =
  | { kind: "general"; modules: string[] }
  | { kind: "specific"; modules: string[] };

const ROUTE_SYSTEM = `你是「AI 工作台」的模块路由器，只做一件事：判断用户问题涉及哪些功能模块。
可选模块清单（id｜名称｜职责）：
${moduleDigest()}

输出规则（只输出 JSON，不要解释）：
- 只有当用户在问「这个站/工作台能做什么、有哪些功能、入口在哪、怎么开通、有哪些面板」这类**全站概览**问题时，才输出 {"kind":"general"}
- 其它所有问题（要查数据、要操作、要写东西、问某个具体功能怎么用）都输出 {"kind":"specific","modules":["模块id",...]}，挑最相关的 1~4 个模块
- 模块 id 必须从上面的清单里选；拿不准时宁可多给一个相关模块，不要返回 general

示例：
- "这个网站能做什么" → {"kind":"general"}
- "我有几封未读邮件" → {"kind":"specific","modules":["mail"]}
- "帮我发封邮件给老板" → {"kind":"specific","modules":["mail"]}
- "知识库怎么上传文档" → {"kind":"specific","modules":["kb"]}
- "帮我建一个项目并写README" → {"kind":"specific","modules":["projects","code"]}
- "今天有什么日程" → {"kind":"specific","modules":["schedule"]}
- "客户张三的跟进记录" → {"kind":"specific","modules":["crm"]}`;

/** 能力路由 + 检索服务：
 *  1. 启动时把操作目录生成的能力手册灌入系统 KB；
 *  2. 每轮对话先用廉价 LLM 调用做意图路由，锁定相关模块；
 *  3. 从系统 KB 检索这些模块的能力片段，注入主对话的 system prompt。
 *  目的：把每轮 ~33k tokens（122 工具全量）降到 ~6-10k，且开放性问题答案更稳定。 */
@Injectable()
export class CapabilityService implements OnModuleInit {
  private readonly log = new Logger("capability");

  constructor(
    private readonly lightrag: LightRagService,
    private readonly llm: LlmAdapter,
    private readonly models: ModelsService,
  ) {}

  async onModuleInit() {
    // 不阻塞启动：后台摄入能力文档（LightRAG 处理较慢，失败只打日志）
    // 开发阶段 LightRAG 未配 API Key 会刷 403 告警，暂时注释（上线前恢复）
    // void this.ensureCapabilityDocs().catch((e) =>
    //   this.log.warn(`ensureCapabilityDocs failed: ${(e as Error).message}`),
    // );
  }

  /** 把操作目录生成的能力手册灌入 LightRAG（已存在则跳过）。
   *  直接走 LightRagService，不写 kb_documents 表，避免系统用户 FK 问题。
   *  存在性检查用 listDocPaths（不占 LLM/embedding 资源），避免 pipeline 忙时被 queryData 阻塞。 */
  async ensureCapabilityDocs(): Promise<void> {
    const docs = buildCapabilityDocs();
    let existing: Set<string> = new Set();
    try {
      const paths = await this.lightrag.listDocPaths();
      existing = new Set(paths.filter((p) => p.startsWith(CAPABILITY_DOC_PREFIX)));
    } catch {
      // LightRAG 不可用时跳过摄入
    }
    let added = 0;
    for (const doc of docs) {
      const docId = `${CAPABILITY_DOC_PREFIX}${doc.id}`;
      if (existing.has(docId)) continue;
      await this.lightrag.insertText(docId, doc.content);
      added += 1;
    }
    if (added) this.log.log(`▸ 已摄入 ${added} 篇能力手册到 LightRAG（共 ${docs.length} 模块）`);
    else this.log.log(`▸ 能力手册已存在（${existing.size} 篇），跳过摄入`);
  }

  /** 意图路由：一次廉价、低温度的非流式 LLM 调用，判定问题涉及哪些模块。
   *  依次尝试所有真实可用模型（某账号欠费/失败时自动换下一个），避免单点故障导致路由全降级。
   *  近期失败过的模型会被短期跳过（5 分钟），避免每轮都先踩坑拖慢首字延迟。 */
  async route(question: string): Promise<RouteResult> {
    const realModels = await this.models.listRealModels();
    const now = Date.now();
    const candidates = realModels.filter((m) => {
      const failedAt = failedModels.get(m.id);
      return !failedAt || now - failedAt > ROUTE_FAIL_TTL_MS;
    });
    // 如果全部在冷却期，退回去全部试一次（宁可慢一点也不能不路由）
    const pool = candidates.length > 0 ? candidates : realModels;

    const messages: ChatMessage[] = [
      { role: "system", content: ROUTE_SYSTEM },
      { role: "user", content: question },
    ];
    let lastErr: Error | null = null;
    for (const model of pool) {
      try {
        const resp = await this.llm.chat({
          endpoint: model.endpoint,
          apiKey: model.apiKey,
          model: model.modelName,
          messages,
          temperature: 0,
          timeoutMs: 10_000,
        });
        // 成功：清除该模型的失败标记
        failedModels.delete(model.id);
        return parseRoute(resp.content);
      } catch (e) {
        lastErr = e as Error;
        failedModels.set(model.id, now);
        this.log.warn(`route with ${model.modelName} failed: ${(e as Error).message}`);
      }
    }
    return { kind: "general", modules: [] };
  }

  /** 从 LightRAG 检索与问题相关的能力片段（只取 capability: 前缀的文档），返回拼接文本。
   *  用 quick 模式（纯向量）而非 deep（图谱推理）：能力手册是结构化文档，向量检索足够且快得多，
   *  避免 deep 模式 120s 超时拖垮整轮对话。
   *  外层包 5s 超时：LightRAG pipeline 忙（如正在摄入）时 query/data 会阻塞，此时直接返回空，
   *  让模型回退到 site.capabilities 工具，不卡住整轮对话。pipeline 空闲时向量检索 <1s 返回。 */
  async retrieve(question: string, topK = 6): Promise<string> {
    try {
      const chunks = await Promise.race([
        this.lightrag.queryData(question, topK * 3, "quick"),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("capability retrieve timeout")), 5_000),
        ),
      ]);
      const capChunks = chunks.filter((c) =>
        (c.file_path ?? "").startsWith(CAPABILITY_DOC_PREFIX),
      );
      if (capChunks.length === 0) return "";
      return capChunks
        .slice(0, topK)
        .map((c, i) => `[能力手册 ${i + 1}] ${c.content}`)
        .join("\n\n");
    } catch (e) {
      this.log.warn(`retrieve capability failed: ${(e as Error).message}`);
      return "";
    }
  }
}

/** 容错解析路由结果：模型可能输出 ```json 包裹、带前后缀解释、或非标准 JSON */
function parseRoute(raw: string): RouteResult {
  // 1. 去掉代码块标记
  let text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  // 2. 提取第一个 { ... } 块（处理模型带前后解释的情况）
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) text = braceMatch[0];
  try {
    const obj = JSON.parse(text) as { kind?: string; modules?: unknown };
    if (obj.kind === "general") return { kind: "general", modules: [] };
    const mods = Array.isArray(obj.modules)
      ? obj.modules.filter((m): m is string => typeof m === "string")
      : [];
    if (mods.length === 0) return { kind: "general", modules: [] };
    return { kind: "specific", modules: mods };
  } catch {
    // 3. JSON 解析失败：从文本里抓已知模块 id
    const ids = moduleIdSet();
    const found = [...text.matchAll(/[a-z]+/g)]
      .map((m) => m[0])
      .filter((id) => ids.has(id));
    if (found.length) return { kind: "specific", modules: [...new Set(found)].slice(0, 4) };
    return { kind: "general", modules: [] };
  }
}

let _moduleIds: Set<string> | null = null;
function moduleIdSet(): Set<string> {
  if (_moduleIds) return _moduleIds;
  _moduleIds = new Set(buildCapabilityDocs().map((d) => d.id));
  return _moduleIds;
}
