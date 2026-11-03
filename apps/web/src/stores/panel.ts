import { create } from "zustand";

/** 面板注册表：已实现的映射到真实组件，其余显示占位 */
export const PANEL_IDS = ["models", "agents", "history", "stats", "kb", "projects", "code", "cal", "mail", "notify", "biz", "crm", "pipe", "resume", "tools", "aitools"] as const;
export type PanelId = (typeof PANEL_IDS)[number];

export const PANEL_META: Record<PanelId, { title: string; path: string }> = {
  models: { title: "模型管理", path: "~/models" },
  agents: { title: "AI 助手", path: "~/agents" },
  history: { title: "执行历史", path: "~/history" },
  stats: { title: "访问统计", path: "~/stats" },
  kb: { title: "AI 知识库", path: "~/kb" },
  projects: { title: "项目管理", path: "~/projects" },
  code: { title: "代码管理", path: "~/code" },
  cal: { title: "日程管理", path: "~/cal" },
  mail: { title: "邮件管理", path: "~/mail" },
  notify: { title: "站内信", path: "~/notify" },
  biz: { title: "商业化管理", path: "~/biz" },
  crm: { title: "客户管理", path: "~/crm" },
  pipe: { title: "流水线工厂", path: "~/pipe" },
  resume: { title: "个人简历", path: "~/me" },
  tools: { title: "百宝箱", path: "~/tools" },
  aitools: { title: "工具管理", path: "~/aitools" },
};

interface PanelState {
  open: PanelId[];
  active: PanelId | null;
  fullscreen: boolean;
  openPanel: (id: PanelId) => void;
  closePanel: (id: PanelId) => void;
  activate: (id: PanelId) => void;
  toggleFullscreen: () => void;
  closeAll: () => void;
}

export const usePanelStore = create<PanelState>()((set) => ({
  open: [],
  active: null,
  fullscreen: false,
  openPanel: (id) =>
    set((s) => ({
      open: s.open.includes(id) ? s.open : [...s.open, id],
      active: id,
      fullscreen: false,
    })),
  closePanel: (id) =>
    set((s) => {
      const open = s.open.filter((p) => p !== id);
      return {
        open,
        active: s.active === id ? (open[open.length - 1] ?? null) : s.active,
        fullscreen: false,
      };
    }),
  activate: (id) => set({ active: id }),
  toggleFullscreen: () => set((s) => ({ fullscreen: !s.fullscreen })),
  closeAll: () => set({ open: [], active: null, fullscreen: false }),
}));
