/** 代码管理（code 模块）共享类型 —— 一个仓库是一棵文件树 */

export interface CodeRepoDto {
  id: string;
  /** 仓库名，如 ai-workbench */
  name: string;
  /** 一句话描述 */
  description: string;
  /** 主语言标签，如 typescript / go / shell */
  language: string;
  /** 当前分支，一期仅展示，不做真实 git */
  branch: string;
  fileCount: number;
  /** 全部文件 UTF-8 字节数之和 */
  sizeBytes: number;
  createdAt: number;
  updatedAt: number;
}

export interface CodeRepoInput {
  name: string;
  description?: string;
  language?: string;
  branch?: string;
}

export interface CodeRepoPatchInput {
  name?: string;
  description?: string;
  language?: string;
  branch?: string;
}

export interface CodeFileDto {
  id: string;
  repoId: string;
  /** 相对路径，如 src/index.ts */
  path: string;
  size: number;
  createdAt: number;
  updatedAt: number;
}

export interface CodeFileDetailDto extends CodeFileDto {
  content: string;
}

export interface CodeFileInput {
  path: string;
  /** 一期仅支持文本类文件 */
  content?: string;
}

export interface CodeFilePatchInput {
  path?: string;
  content?: string;
}
