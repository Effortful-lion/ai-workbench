/** 模型管理（OpenAI 兼容协议为基准的厂商接入） */
export const MODEL_STATUSES = ["ok", "error", "untested"] as const;
export type ModelStatus = (typeof MODEL_STATUSES)[number];

/** 模型类型：对话（推理）/ 向量（embedding） */
export const MODEL_KINDS = ["chat", "embedding"] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

export interface ModelDto {
  id: string;
  /** 厂商标识，如 openai / deepseek / qwen / ollama */
  provider: string;
  /** 模型名，如 gpt-4o-mini */
  modelName: string;
  /** OpenAI 兼容 base url，如 https://api.openai.com/v1 */
  endpoint: string;
  /** 模型类型：chat = 对话，embedding = 向量 */
  kind: ModelKind;
  /** 是否已配置 key（永不回传明文） */
  hasKey: boolean;
  status: ModelStatus;
  /** 默认模型：聊天未指定 modelId 时优先选用（全局唯一） */
  isDefault: boolean;
  /** 定价：分 / 1k tokens；0 = 未知/不计费 */
  priceIn: number;
  priceOut: number;
  meta: {
    latencyMs?: number;
    lastCheckedAt?: number;
    lastError?: string;
    priceNote?: string;
    /** 采样温度，缺省由厂商决定 */
    temperature?: number;
    /** top_k 采样，缺省由厂商决定 */
    topK?: number;
  } | null;
}

/** gateway 内部用的简版模型结构（含 pricing 用于 cost 换算） */
export interface ModelRuntime {
  id: string;
  provider: string;
  modelName: string;
  endpoint: string;
  apiKey: string | null;
  priceIn: number;
  priceOut: number;
}

export interface ModelTestResult {
  ok: boolean;
  reply?: string;
  latencyMs: number;
  error?: string;
}
