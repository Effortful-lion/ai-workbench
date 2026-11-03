/** 百宝箱（toolbox 模块）共享类型 —— 一条工具就像一条终端 alias，
 *  载体分两类：link = 外链文本，file = 上传的文件（二进制 / 安装包 / 压缩包 / 技能包） */

export const TOOLBOX_KINDS = ["link", "file"] as const;
export type ToolboxKind = (typeof TOOLBOX_KINDS)[number];

export interface ToolboxItemDto {
  id: string;
  /** 别名，缺省从 URL 主机名或文件名推导，如 cursor */
  name: string;
  /** link = 外链，file = 上传文件 */
  kind: ToolboxKind;
  /** link 为外链地址；file 为站内下载路径 /api/toolbox/files/:id */
  url: string;
  /** 分类标签，不带 #，如 db / skill / dev / ops */
  category: string;
  desc: string;
  useCount: number;
  createdAt: number;
  /** file 类的原文件名 */
  fileName?: string;
  /** file 类的字节数 */
  fileSize?: number;
  /** file 类的 MIME */
  mimeType?: string;
}

export interface ToolboxItemInput {
  url: string;
  name?: string;
  category?: string;
  desc?: string;
}
