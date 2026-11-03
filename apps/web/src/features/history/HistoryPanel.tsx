import { useEffect, useState } from "react";
import type { AgentExecutionTrace, TraceEvent } from "@aiwb/shared";
import { api } from "../../lib/api";
import { useAgentsStore } from "../../stores/agents";

/** 全局执行历史面板：最近 30 次 Agent 运行的 cost + trace 速览 */
export default function HistoryPanel() {
  const agents = useAgentsStore((s) => s.agents);
  const [traces, setTraces] = useState<AgentExecutionTrace[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api<AgentExecutionTrace[]>("/agents/executions?limit=50")
      .then(setTraces)
      .catch(() => setTraces([]))
      .finally(() => setLoading(false));
  }, []);

  const agentName = (id: string | null) =>
    id ? agents.find((a) => a.id === id)?.name ?? id.slice(0, 8) + "…" : "直跑模式";

  const statusColor: Record<string, string> = {
    done: "text-acc",
    failed: "text-err",
    budget: "text-warn",
    running: "text-info",
  };

  return (
    <div className="mx-auto w-[min(900px,94%)] py-8 font-mono">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-xs text-tx3">~/history · 执行历史 · 最近 {traces.length} 条</div>
        <button
          className="rounded border border-line px-2.5 py-1 text-[11px] text-tx2 hover:border-acc hover:text-acc"
          onClick={() => window.location.reload()}
        >
          ↻ 刷新
        </button>
      </div>

      {loading && <div className="text-[11px] text-tx3">// 加载中…</div>}

      {!loading && traces.length === 0 && (
        <div className="rounded-lg border border-dashed border-line py-12 text-center text-xs text-tx3">
          还没有 Agent 执行记录 —— 跑一轮 Agent 对话就会生成迹线
        </div>
      )}

      <div className="flex flex-col gap-2">
        {traces.map((t) => (
          <div key={t.id} className="rounded-lg border border-line bg-bg1 transition-colors hover:border-acc/40">
            <button
              className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px]"
              onClick={() => setExpanded(expanded === t.id ? null : t.id)}
            >
              <div className="flex items-center gap-3">
                <span className={statusColor[t.status] ?? "text-tx3"}>
                  {expanded === t.id ? "▾" : "▸"} {t.status}
                </span>
                <span className="text-tx">{agentName(t.agentId)}</span>
                <span className="text-tx3">· {t.modelName}</span>
                {t.phaseName && <span className="text-warn">· phase={t.phaseName}</span>}
              </div>
              <div className="flex items-center gap-3 text-tx3">
                <span className="text-warn">¥{(t.costYuan / 100).toFixed(2)}</span>
                <span>{t.tokensUsed} tok</span>
                <span>{(t.durationMs / 1000).toFixed(1)}s</span>
                <span>{new Date(t.startedAt).toLocaleTimeString("zh-CN")}</span>
              </div>
            </button>

            {expanded === t.id && (
              <div className="border-t border-line bg-bg2/50 px-3 py-2">
                <TraceTree events={t.events} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 轻量 trace 事件树状渲染（和 TracePanel 风格一致） */
function TraceTree({ events }: { events: TraceEvent[] }) {
  return (
    <div className="flex flex-col gap-0.5 text-[11px]">
      {events.map((e, i) => {
        const isDone = e.type.endsWith(".done") || e.type === "agent.done";
        const isFail = e.type.endsWith(".failed") || e.type === "agent.failed";
        // summary 自带 ▶ / ✓ / ✗，这里只画树状缩进
        const tree = i === 0 ? "▸" : isDone ? "└" : "├";
        const color = isFail ? "text-err" : isDone ? "text-acc" : "text-tx2";
        return (
          <div key={i} className={`${color} leading-relaxed`}>
            <span className="mr-2 text-tx3">{new Date(e.ts).toLocaleTimeString("zh-CN", { hour12: false })}</span>
            {tree} {e.summary}
          </div>
        );
      })}
    </div>
  );
}
