/** AI 知识库（kb 模块）共享类型 */

export interface KbDocumentDto {
  id: string;
  title: string;
  /** 终端文件树风格的虚拟路径，如 ~/kb/部署手册.md */
  path: string;
  mime: string;
  size: number;
  status: "embedded" | "pending" | "error";
  chunkCount: number;
  error?: string | null;
  createdAt: number;
}

export interface KbIngestInput {
  title: string;
  /** 纯文本内容（一期仅支持文本类文档） */
  content: string;
  mime?: string;
}

export interface KbSearchHitDto {
  docId: string;
  docTitle: string;
  chunkIx: number;
  /** 余弦相似度 0..1 */
  score: number;
  text: string;
}

export interface KbSearchResultDto {
  query: string;
  hits: KbSearchHitDto[];
  /** embedding 来源：model=真实模型接口 / local=本地确定性向量 */
  embedding: "model" | "local";
  latencyMs: number;
}

export interface KbAskInput {
  query: string;
  topK?: number;
}

/** 检索即对话：AI 基于知识库片段作答，answer 中的 [n] 对应 citations 下标 + 1 */
export interface KbAskResultDto {
  query: string;
  answer: string;
  citations: KbSearchHitDto[];
  embedding: "model" | "local";
  /** llm=真实对话模型生成 / extractive=无可用模型时的本地抽取式回答 */
  source: "llm" | "extractive";
  model?: string;
  latencyMs: number;
}
