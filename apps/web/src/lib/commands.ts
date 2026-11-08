import { PANEL_IDS, type PanelId } from "../stores/panel";

export type Command =
  | { kind: "panel"; cmd: string; panel: PanelId; label: string; desc: string }
  | { kind: "action"; cmd: string; action: ActionKey; label: string; desc: string };

export type ActionKey =
  | "new"
  | "clear"
  | "cli"
  | "home"
  | "theme"
  | "help"
  | "logout";

const PANEL_NAMES: Record<PanelId, string> = {
  models: "模型管理",
  agents: "AI 助手",
  history: "执行历史",
  stats: "访问统计",
  kb: "AI 知识库",
  projects: "项目管理",
  code: "代码管理",
  cal: "日程管理",
  mail: "邮件管理",
  notify: "站内信",
  biz: "商业化",
  crm: "客户管理",
  pipe: "流水线",
  resume: "个人简历",
  tools: "百宝箱",
  aitools: "工具管理",
  gh: "GitHub 观察窗",
};

/** 全部斜杠命令。cmd 就是用户输入的完整形式（不带 /） */
export const COMMANDS: Command[] = [
  ...PANEL_IDS.map<Command>((id) => ({
    kind: "panel",
    cmd: id,
    panel: id,
    label: `/${id}`,
    desc: `打开 ${PANEL_NAMES[id]}`,
  })),
  // 别名
  { kind: "panel", cmd: "calendar", panel: "cal", label: "/calendar", desc: "打开日程管理" },
  { kind: "panel", cmd: "schedule", panel: "cal", label: "/schedule", desc: "打开日程管理" },
  { kind: "panel", cmd: "commerce", panel: "biz", label: "/commerce", desc: "打开商业化" },
  { kind: "panel", cmd: "resume", panel: "resume", label: "/resume", desc: "打开个人简历" },
  // 动作
  { kind: "action", cmd: "new", action: "new", label: "/new", desc: "开始新对话" },
  { kind: "action", cmd: "clear", action: "clear", label: "/clear", desc: "清屏" },
  { kind: "action", cmd: "cli", action: "cli", label: "/cli", desc: "进入 CLI 沉浸模式" },
  { kind: "action", cmd: "home", action: "home", label: "/home", desc: "回到首页" },
  { kind: "action", cmd: "theme", action: "theme", label: "/theme", desc: "切换主题色系" },
  { kind: "action", cmd: "help", action: "help", label: "/help", desc: "AI 能做什么" },
  { kind: "action", cmd: "logout", action: "logout", label: "/logout", desc: "退出登录" },
];

/** 从输入 "/xxx" 过滤出匹配的命令；空 "/" 返回全部 */
export function matchCommands(input: string): Command[] {
  const q = input.startsWith("/") ? input.slice(1).toLowerCase() : "";
  if (!q) return COMMANDS;
  return COMMANDS.filter(
    (c) => c.cmd.includes(q) || c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q),
  );
}
