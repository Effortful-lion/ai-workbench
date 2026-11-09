import type { BlogCategory, BlogPublicPostDto } from "@aiwb/shared";

/** 分类元数据：导航词标签与排序权重集中在此，列表/面板/阅读页共用 */
export const CATEGORY_META: Record<BlogCategory, { label: string; key: string }> = {
  kb: { label: "#知识库", key: "kb" },
  agent: { label: "#Agent", key: "agent" },
  pipe: { label: "#管道", key: "pipe" },
  essay: { label: "#随笔", key: "essay" },
};

export const CATEGORY_TABS = ["#全部", "#知识库", "#Agent", "#管道", "#随笔"] as const;

/** 导航词 → 分类 key；#全部 → null */
export function categoryKeyOf(label: string): BlogCategory | null {
  const hit = Object.entries(CATEGORY_META).find(([, m]) => m.label === label);
  return hit ? (hit[0] as BlogCategory) : null;
}

export type SortMode = "最新" | "最早" | "最长";

export const SORT_MODES: SortMode[] = ["最新", "最早", "最长"];

/** 列表排序：最新（默认）/ 最早 / 最长（按字数） */
export function sortPosts<T extends Pick<BlogPublicPostDto, "publishedAt" | "charCount">>(
  posts: T[],
  mode: SortMode,
): T[] {
  const arr = posts.slice();
  if (mode === "最早") arr.sort((a, b) => a.publishedAt - b.publishedAt);
  else if (mode === "最长") arr.sort((a, b) => b.charCount - a.charCount);
  else arr.sort((a, b) => b.publishedAt - a.publishedAt);
  return arr;
}

/** 日期：2026.11.09 */
export function formatDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

/** 日期时间：2026.11.09 19:20 */
export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${formatDate(ts)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 预计阅读分钟：按 450 字/分钟，最少 1 分钟 */
export function readMinutes(charCount: number): number {
  return Math.max(1, Math.round(charCount / 450));
}

/** 字数刻度宽度（百分比）：最短 12%，按全列表最大值归一化 */
export function tickWidth(charCount: number, max: number): number {
  if (!max) return 12;
  return 12 + Math.round((charCount / max) * 88);
}

export interface Heading {
  id: string;
  text: string;
  level: 2 | 3;
}

export interface BlogSection {
  id: string;
  md: string;
}

/** 按 `##` / `###` 切段：渲染锚点与目录共用同一套 id，代码块内标题不参与 */
export function splitSections(md: string): BlogSection[] {
  const out: BlogSection[] = [];
  let buf: string[] = [];
  let inFence = false;
  const push = () => {
    if (!buf.length) return;
    out.push({ id: `sec-${out.length}`, md: buf.join("\n") });
    buf = [];
  };
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```")) inFence = !inFence;
    if (!inFence && /^#{2,3}\s+/.test(line)) push();
    buf.push(raw);
  }
  push();
  return out;
}

/** 目录：从切段结果里取标题，锚点 id 与 BlogMarkdown 一一对应 */
export function parseHeadings(md: string): Heading[] {
  const out: Heading[] = [];
  for (const s of splitSections(md)) {
    const first = s.md.split("\n").find((l) => l.trim()) ?? "";
    const m = /^(#{2,3})\s+(.+)$/.exec(first.trim());
    if (!m) continue;
    out.push({
      id: s.id,
      text: m[2].replace(/[*_`]/g, "").trim(),
      level: m[1].length === 2 ? 2 : 3,
    });
  }
  return out;
}

/** 评论首字头像：取昵称前两位 */
export function avatarText(nickname: string): string {
  return nickname.trim().slice(0, 2) || "匿";
}
