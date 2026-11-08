/** AI 知识库（kb 模块）共享类型 */

/** kb 目录节点：纯视图容器，不持有文档本体，不参与检索 */
export interface KbFolderDto {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  /** 该目录下直接挂载的文档数 */
  docCount: number;
  createdAt: number;
}

/** 目录树节点：带子目录的递归结构 */
export interface KbFolderNodeDto extends KbFolderDto {
  children: KbFolderNodeDto[];
}

/** 软链接：文档 ↔ 目录挂载关系，仅引用，不复制本体/切片/向量 */
export interface KbLinkDto {
  id: string;
  documentId: string;
  folderId: string;
  createdAt: number;
}

/** 目录树 + 全部挂载关系，前端本地拼装视图 */
export interface KbFolderTreeDto {
  folders: KbFolderNodeDto[];
  links: KbLinkDto[];
}

/** 新建目录入参：parentId 缺省=根目录 */
export interface KbCreateFolderInput {
  name: string;
  parentId?: string;
}

/** 更新目录入参：重命名 / 移动（parentId=null 移到根） */
export interface KbUpdateFolderInput {
  name?: string;
  parentId?: string | null;
}

/** 挂载入参：把文档软链接到目录 */
export interface KbLinkInput {
  documentId: string;
  folderId: string;
}

export interface KbSearchInput {
  query: string;
  topK?: number;
  /** 传入=目录范围检索（含子目录）；不传=全局扁平召回 */
  folderId?: string;
}

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
  /** 主归属目录 id（原始上传路径），null=未归类 */
  primaryFolderId?: string | null;
  createdAt: number;
}

export interface KbIngestInput {
  title: string;
  /** 纯文本内容（一期仅支持文本类文档） */
  content: string;
  mime?: string;
  /** 主归属目录 id：写入 chunk primary_path 做路径语义增强；缺省=未归类 */
  folderId?: string;
}

export interface KbSearchHitDto {
  docId: string;
  docTitle: string;
  chunkIx: number;
  /** 余弦相似度 0..1 */
  score: number;
  text: string;
  /** 主归属虚拟路径（路径语义增强，可空=存量文档未回填） */
  primaryPath?: string;
}

export interface KbSearchResultDto {
  query: string;
  hits: KbSearchHitDto[];
  /** embedding 来源：model=真实模型接口 / local=本地确定性向量 */
  embedding: "model" | "local";
  latencyMs: number;
  /** true=目录范围检索经 LightRAG 全局召回后应用层过滤（结果可能少于 topK） */
  scopeFiltered?: boolean;
}

/** 检索深度：
 *  quick=仅向量直取（秒级，适合单点事实/原文定位）
 *  deep=图谱+向量推理（数十秒，适合跨文档多跳/因果归纳） */
export type KbAskMode = "quick" | "deep";

export interface KbAskInput {
  query: string;
  topK?: number;
  /** 缺省为 deep，保持既有行为 */
  mode?: KbAskMode;
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
  /** 本次实际使用的检索深度 */
  mode: KbAskMode;
  latencyMs: number;
}
