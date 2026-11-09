import {
  Archive, ArrowLeft, ArrowUpDown, BookOpen, ChevronLeft, ChevronRight, Clock, Eye,
  ExternalLink, FileText, List, MessageSquare, Newspaper, PenLine, RotateCcw, Send, Tag, Trash2,
} from "lucide-react";

/**
 * 统一图标注册表：语义名 → lucide 线性图标。
 * 全应用图标整改按此表逐模块扩展（本轮仅博客 + KB 发布动作）。
 * 视觉约定：1.5px 描边、默认 14px、颜色继承 currentColor。
 */
const ICONS = {
  /** 发布到博客（纸飞机） */
  publish: Send,
  /** 下架（归档盒） */
  archive: Archive,
  /** 重新上架（回旋箭头） */
  restore: RotateCcw,
  /** 移除（垃圾桶） */
  trash: Trash2,
  /** 博客 / 阅读 */
  blog: BookOpen,
  /** 评论 */
  comment: MessageSquare,
  /** 返回 */
  back: ArrowLeft,
  /** 上一篇 */
  prev: ChevronLeft,
  /** 下一篇 */
  next: ChevronRight,
  /** 目录 */
  toc: List,
  /** 预览原文 */
  preview: Eye,
  /** 博客面板 */
  newspaper: Newspaper,
  /** 书写 */
  write: PenLine,
  /** KB 文档 */
  doc: FileText,
  /** 公开地址 / 外链 */
  external: ExternalLink,
  /** 排序 */
  sort: ArrowUpDown,
  /** 阅读时长 */
  clock: Clock,
  /** 标签 */
  tag: Tag,
} as const;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function Icon({ name, size = 14, strokeWidth = 1.5, className }: IconProps) {
  const C = ICONS[name];
  return <C size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" />;
}
