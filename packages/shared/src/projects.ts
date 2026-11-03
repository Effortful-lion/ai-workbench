/** 项目管理（projects 模块）共享类型 —— 一个项目就是一棵文档树 */

export const PROJECT_STATUSES = ["active", "paused", "done"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface ProjectDto {
  id: string;
  /** 项目名（短横线风格），同时是文档树目录名，如 ai-workbench */
  name: string;
  /** 一句话描述 */
  title: string;
  status: ProjectStatus;
  docCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectInput {
  name: string;
  title?: string;
  status?: ProjectStatus;
}

export interface ProjectPatchInput {
  name?: string;
  title?: string;
  status?: ProjectStatus;
}

/** 文档元数据：path 由 project.name + title 推导，不落库，改名后自动跟随 */
export interface ProjectDocDto {
  id: string;
  projectId: string;
  title: string;
  /** 终端文件树风格路径，如 ~/projects/ai-workbench/需求准备.md */
  path: string;
  size: number;
  /** 每次内容/标题变更 +1，为后期 git 语义预留 */
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectDocDetailDto extends ProjectDocDto {
  content: string;
}

export interface ProjectDocInput {
  title: string;
  /** 允许空文档，稍后再写入内容 */
  content?: string;
}

export interface ProjectDocPatchInput {
  title?: string;
  content?: string;
}
