import type { ModelKind } from "@aiwb/shared";

export interface ProviderPreset {
  value: string;
  label: string;
  baseURL: string;
  models: Record<ModelKind, string[]>;
}

/** 主流厂商预设：baseURL 按 OpenAI 兼容协议填写，模型名可下拉选择也可手填 */
export const PROVIDERS: ProviderPreset[] = [
  {
    value: "openai",
    label: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    models: {
      chat: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o3-mini"],
      embedding: ["text-embedding-3-small", "text-embedding-3-large"],
    },
  },
  {
    value: "deepseek",
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    models: {
      chat: ["deepseek-chat", "deepseek-reasoner"],
      embedding: [],
    },
  },
  {
    value: "qwen",
    label: "通义千问",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: {
      chat: ["qwen-plus", "qwen-max", "qwen-turbo"],
      embedding: ["text-embedding-v3", "text-embedding-v4"],
    },
  },
  {
    value: "moonshot",
    label: "Moonshot",
    baseURL: "https://api.moonshot.cn/v1",
    models: {
      chat: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
      embedding: [],
    },
  },
  {
    value: "zhipu",
    label: "智谱 GLM",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    models: {
      chat: ["glm-4-plus", "glm-4-flash", "glm-4-air"],
      embedding: ["embedding-3"],
    },
  },
  {
    value: "volces-ark",
    label: "火山方舟",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    models: {
      chat: ["doubao-seed-2-0-lite-260428", "doubao-pro-32k"],
      embedding: ["doubao-embedding-large"],
    },
  },
  {
    value: "ollama",
    label: "Ollama（本地）",
    baseURL: "http://localhost:11434/v1",
    models: {
      chat: ["llama3.1", "qwen2.5"],
      embedding: ["nomic-embed-text", "bge-m3"],
    },
  },
  {
    value: "custom",
    label: "自定义",
    baseURL: "",
    models: { chat: [], embedding: [] },
  },
];

export const KIND_LABEL: Record<ModelKind, string> = {
  chat: "对话",
  embedding: "向量",
};
