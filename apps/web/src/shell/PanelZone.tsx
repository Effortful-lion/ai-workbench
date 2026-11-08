import type { ReactNode } from "react";
import ModelsPanel from "../features/models/ModelsPanel";
import AgentsPanel from "../features/agents/AgentsPanel";
import KbPanel from "../features/kb/KbPanel";
import ProjectsPanel from "../features/projects/ProjectsPanel";
import CodePanel from "../features/code/CodePanel";
import SchedulePanel from "../features/schedule/SchedulePanel";
import MailPanel from "../features/mail/MailPanel";
import NotifyPanel from "../features/notify/NotifyPanel";
import CommercePanel from "../features/commerce/CommercePanel";
import CrmPanel from "../features/crm/CrmPanel";
import PipePanel from "../features/pipe/PipePanel";
import ResumePanel from "../features/resume/ResumePanel";
import ToolboxPanel from "../features/tools/ToolboxPanel";
import ToolsManagerPanel from "../features/aitools/ToolsManagerPanel";
import HistoryPanel from "../features/history/HistoryPanel";
import StatsPanel from "../features/stats/StatsPanel";
import GithubPanel from "../features/github/GithubPanel";
import { PANEL_META, usePanelStore, type PanelId } from "../stores/panel";

const PANEL_BODY: Record<PanelId, () => ReactNode> = {
  models: () => <ModelsPanel />,
  agents: () => <AgentsPanel />,
  history: () => <HistoryPanel />,
  stats: () => <StatsPanel />,
  kb: () => <KbPanel />,
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

/** 状态 B · 面板区：tabs + 内容 + ⤢ 全屏 */
export default function PanelZone() {
  const { open, active, fullscreen, activate, closePanel, toggleFullscreen } = usePanelStore();
  if (!active) return null;

  return (
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-20 flex flex-col bg-bg"
          : "flex h-full min-w-0 flex-1 flex-col"
      }
    >
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
              <span>{id === active ? "▸" : "·"}</span>
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
      {/* 内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto">{PANEL_BODY[active]()}</div>
    </div>
  );
}
