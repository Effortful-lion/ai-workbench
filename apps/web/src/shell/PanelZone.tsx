import { lazy, Suspense, type ReactNode } from "react";
import { useAuthStore } from "../stores/auth";
import { canOpenPanel } from "../lib/panel-access";

// 面板按需加载：首屏只带 shell，19 个面板各自成独立 chunk
const ModelsPanel = lazy(() => import("../features/models/ModelsPanel"));
const AgentsPanel = lazy(() => import("../features/agents/AgentsPanel"));
const KbPanel = lazy(() => import("../features/kb/KbPanel"));
const BlogPanel = lazy(() => import("../features/blog/BlogPanel"));
const ProjectsPanel = lazy(() => import("../features/projects/ProjectsPanel"));
const CodePanel = lazy(() => import("../features/code/CodePanel"));
const SchedulePanel = lazy(() => import("../features/schedule/SchedulePanel"));
const MailPanel = lazy(() => import("../features/mail/MailPanel"));
const NotifyPanel = lazy(() => import("../features/notify/NotifyPanel"));
const CommercePanel = lazy(() => import("../features/commerce/CommercePanel"));
const CrmPanel = lazy(() => import("../features/crm/CrmPanel"));
const PipePanel = lazy(() => import("../features/pipe/PipePanel"));
const ResumePanel = lazy(() => import("../features/resume/ResumePanel"));
const ToolboxPanel = lazy(() => import("../features/tools/ToolboxPanel"));
const ToolsManagerPanel = lazy(() => import("../features/aitools/ToolsManagerPanel"));
const HistoryPanel = lazy(() => import("../features/history/HistoryPanel"));
const StatsPanel = lazy(() => import("../features/stats/StatsPanel"));
const GithubPanel = lazy(() => import("../features/github/GithubPanel"));
import { PANEL_META, usePanelStore, type PanelId } from "../stores/panel";
import { Icon } from "../lib/icons";

const PANEL_BODY: Record<PanelId, () => ReactNode> = {
  models: () => <ModelsPanel />,
  agents: () => <AgentsPanel />,
  history: () => <HistoryPanel />,
  stats: () => <StatsPanel />,
  kb: () => <KbPanel />,
  blog: () => <BlogPanel />,
  projects: () => <ProjectsPanel />,
  code: () => <CodePanel />,
  cal: () => <SchedulePanel />,
  mail: () => <MailPanel />,
  notify: () => <NotifyPanel />,
  biz: () => <CommercePanel />,
  crm: () => <CrmPanel />,
  pipe: () => <PipePanel />,
  resume: () => <ResumePanel />,
  tools: () => <ToolboxPanel />,
  aitools: () => <ToolsManagerPanel />,
  gh: () => <GithubPanel />,
};

/** 首次打开某个面板时按需载入模块，用终端风占位避免白屏 */
function PanelLoading({ title }: { title: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 font-mono text-[12px] text-tx3">
      <div className="text-acc">⠋ 正在载入 ~/p/{title}</div>
      <div className="text-[11px]">// 模块按需加载，仅首次打开需要</div>
    </div>
  );
}

/** 状态 B · 面板区：tabs + 内容 + ⤢ 全屏 */
export default function PanelZone() {
  const { open, active, fullscreen, activate, closePanel, toggleFullscreen } = usePanelStore();
  const role = useAuthStore((s) => s.user?.role);
  if (!active) return null;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-bg">
      {/* tab 条 */}
      <div className="flex h-[38px] flex-none items-center justify-between border-b border-line bg-bg1 pr-2">
        <div className="flex h-full items-center overflow-x-auto">
          {open.map((id) => (
            <div
              key={id}
              className={`flex h-full cursor-pointer items-center gap-2 border-r border-line px-3 font-mono text-[11px] ${
                id === active ? "bg-bg text-acc" : "text-tx3 hover:text-tx2"
              }`}
              onClick={() => activate(id)}
            >
              {PANEL_META[id].icon ? (
                <Icon name={PANEL_META[id].icon!} size={12} />
              ) : (
                <span>{id === active ? "▸" : "·"}</span>
              )}
              <span>{PANEL_META[id].title}</span>
              <button
                className="text-tx3 hover:text-err"
                onClick={(e) => {
                  e.stopPropagation();
                  closePanel(id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-tx3 hover:border-acc hover:text-acc"
          onClick={toggleFullscreen}
          title={fullscreen ? "退出全屏" : "全屏"}
        >
          {fullscreen ? "⤡" : "⤢"}
        </button>
      </div>
      {/* 内容：危险面板（模型/邮件/自定义工具）只允许站点主人打开 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {canOpenPanel(active, role) ? (
          <Suspense fallback={<PanelLoading title={PANEL_META[active].title} />}>
            {PANEL_BODY[active]()}
          </Suspense>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center font-mono text-[12px] text-tx3">
            <div className="text-[13px] text-err">✗ {PANEL_META[active].title} 仅站点主人可用</div>
            <div>// 该模块涉及凭证或高权限操作，普通账号只读展示其余内容</div>
          </div>
        )}
      </div>
    </div>
  );
}
