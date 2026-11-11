import type { PanelId } from "../stores/panel";

/**
 * 面板可见性（数据 + 权限都归 admin 的模块）。
 *
 * 站点主人（owner）全开；普通 user 只能进：
 * - blog（只读，评论除外）
 * - notify（只看讨论类消息）
 * - resume / contact / toolbox（本站对外展示的公开内容，本来就有 /p /t /c 公开页）
 * - gh（GitHub 观察窗，只读）
 * CLI 终端不属于面板，所有人可用。
 */
export const OWNER_ONLY_PANELS: readonly PanelId[] = [
  "models",
  "agents",
  "history",
  "kb",
  "projects",
  "code",
  "cal",
  "mail",
  "biz",
  "crm",
  "pipe",
  "aitools",
  "stats",
];

export function canOpenPanel(panel: PanelId, role: string | null | undefined): boolean {
  return role === "owner" || !OWNER_ONLY_PANELS.includes(panel);
}
