import { useEffect, useRef, useState } from "react";
import { useChatStore } from "../../stores/chat";
import { api } from "../../lib/api";
import type { AgentExecutionTrace, TraceEvent } from "@aiwb/shared";

/** 类型 → 终端颜色 */
const TYPE_COLOR: Record<string, string> = {
  "agent.started": "text-acc",
  "agent.done": "text-acc",
  "agent.failed": "text-err",
  "agent.aborted": "text-warn",
  "phase.started": "text-tx",
  "phase.done": "text-tx2",
  "tool.started": "text-warn",
  "tool.done": "text-warn",
  "tool.failed": "text-err",
  "budget.hit": "text-err",
  "sub.started": "text-tx2",
  "sub.done": "text-tx2",
};

/** 类型 → 层级（用于缩进） */
const TYPE_DEPTH: Record<string, number> = {
  "agent.started": 0, "agent.done": 0, "agent.failed": 0, "agent.aborted": 0,
  "budget.hit": 0,
  "phase.started": 1, "phase.done": 1,
  "sub.started": 1, "sub.done": 1,
  "tool.started": 2, "tool.done": 2, "tool.failed": 2,
};

/** 类型 → 图标（统一单字符、终端感） */
const TYPE_ICON: Record<string, string> = {
  "agent.started": "▶",
  "agent.done": "✓",
  "agent.failed": "✗",
  "agent.aborted": "■",
  "phase.started": "◐",
  "phase.done": "◑",
  "tool.started": "▸",
  "tool.done": "✓",
  "tool.failed": "✗",
  "budget.hit": "⚠",
  "sub.started": "↳",
  "sub.done": "↲",
};

/** 格式化毫秒 */
function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const ss = (s % 60).toFixed(1);
  return `${m}m${ss.padStart(4, "0")}s`;
}

/** 格式化数字 */
function fmtK(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** 事件 payload 里提取 durationMs（tool.done / tool.failed 才有） */
function extractDuration(ev: TraceEvent): number | null {
  if (ev.type === "tool.done" || ev.type === "tool.failed") {
    const p = ev.payload as Record<string, unknown> | undefined;
    if (typeof p?.durationMs === "number") return p.durationMs;
  }
  return null;
}

/** 单个事件行：带层级缩进 + 图标 + 摘要 + 可选 duration */
function EventRow({ ev }: { ev: TraceEvent }) {
  const depth = ev.depth ?? TYPE_DEPTH[ev.type] ?? 2;
  const duration = extractDuration(ev);
  const indent = Math.min(depth, 3) * 10; // 每层 10px，最多 3 层

  return (
    <div
      className={`group flex items-baseline gap-1.5 whitespace-pre-wrap break-words py-[1px] ${TYPE_COLOR[ev.type] ?? "text-tx2"}`}
      style={{ paddingLeft: indent }}
    >
      {/* 时间戳 */}
      <span className="text-tx3/70 text-[10px] tabular-nums select-none">
        {new Date(ev.ts).toLocaleTimeString("zh-CN", { hour12: false })}
      </span>

      {/* 图标 */}
      <span className="w-3 flex-none text-center select-none">{TYPE_ICON[ev.type] ?? "·"}</span>

      {/* 摘要 */}
      <span className="flex-1">{ev.summary}</span>

      {/* 行尾：duration / error / 额外 info */}
      {duration !== null && (
        <span className="text-tx3 text-[10px] tabular-nums select-none">
          {fmtDuration(duration)}
        </span>
      )}
      {ev.type === "agent.failed" && (ev.payload as any)?.error && (
        <span className="text-tx3 text-[10px] truncate max-w-[120px] select-none">
          {(ev.payload as any).error}
        </span>
      )}
    </div>
  );
}

/** Agent 执行迹线面板：终端风格，层级缩进 + 实时预算 */
export default function TracePanel() {
  const { traceEvents, streaming, currentId } = useChatStore();
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<AgentExecutionTrace[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  // streaming 时自动展开
  useEffect(() => {
    if (streaming && traceEvents.length > 0 && !expanded) setExpanded(true);
  }, [streaming, traceEvents.length, expanded]);

  // trace 事件增长时滚到底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [traceEvents.length]);

  // 加载历史（恢复会话时）
  useEffect(() => {
    if (!currentId) { setHistory([]); return; }
    api<AgentExecutionTrace | null>(`/agents/executions/latest?conversationId=${currentId}`)
      .then((t) => { if (t && t.events?.length) setHistory([t]); })
      .catch(() => {});
  }, [currentId]);

  // ═══ 折叠态：紧凑摘要条 ═══
  if (!expanded) {
    if (traceEvents.length === 0 && history.length === 0) return null;
    const total = traceEvents.length || history[0]?.events?.length || 0;
    const startedAt = traceEvents[0]?.ts ?? history[0]?.startedAt ?? Date.now();
    const lastTs = traceEvents[traceEvents.length - 1]?.ts ?? history[0]?.finishedAt ?? Date.now();
    const elapsed = fmtDuration(lastTs - startedAt);

    // 提取最终状态
    const lastEvent = traceEvents[traceEvents.length - 1] ?? history[0]?.events?.slice(-1)[0];
    const finalOk = lastEvent?.type === "agent.done";
    const finalStop = lastEvent?.type === "agent.aborted";
    const finalFail = lastEvent?.type === "agent.failed" || lastEvent?.type === "budget.hit";

    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex h-[26px] w-full flex-none items-center justify-between border-t border-line bg-bg1 px-3 font-mono text-[10px] hover:bg-bg2"
      >
        <span className="flex items-center gap-2">
          {streaming ? (
            <span className="text-acc animate-pulse">●</span>
          ) : finalOk ? (
            <span className="text-acc">✓</span>
          ) : finalStop ? (
            <span className="text-warn">■</span>
          ) : finalFail ? (
            <span className="text-err">✗</span>
          ) : (
            <span className="text-tx3">·</span>
          )}
          <span className="text-tx3">trace</span>
          {lastEvent && (
            <span className={`truncate max-w-[300px] ${TYPE_COLOR[lastEvent.type] ?? "text-tx2"}`}>
              {lastEvent.summary}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 text-tx3 tabular-nums">
          <span>{total} ev</span>
          <span>·</span>
          <span>{elapsed}</span>
          <span>▾</span>
        </span>
      </button>
    );
  }

  // ═══ 展开态 ═══
  return (
    <div className="flex h-[220px] flex-none flex-col border-t border-line bg-bg1">
      {/* 标题栏 */}
      <div className="flex h-[24px] flex-none items-center justify-between border-b border-line px-3 font-mono text-[10px]">
        <span className="flex items-center gap-2">
          <span className="text-acc">▸ trace</span>
          {streaming && <span className="text-acc animate-pulse">● live</span>}
          {!streaming && traceEvents.length > 0 && <span className="text-tx3">● done</span>}
        </span>
        <div className="flex items-center gap-3 text-tx3">
          <span>{traceEvents.length} ev</span>
          <span
            className="cursor-pointer hover:text-err"
            onClick={() => {
              useChatStore.getState().clearTrace();
              setExpanded(false);
            }}
            title="关闭面板"
          >
            ×
          </span>
        </div>
      </div>

      {/* 事件列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1 font-mono text-[11px]">
        {traceEvents.length === 0 && history.length === 0 && (
          <div className="px-2 py-2 text-tx3">// 等待事件…</div>
        )}

        {/* 实时事件（流式） */}
        {traceEvents.map((ev, i) => (
          <EventRow key={`live-${i}`} ev={ev} />
        ))}

        {/* 历史 trace（恢复会话时） */}
        {traceEvents.length === 0 && history.length > 0 &&
          history.map((h) =>
            h.events.map((ev, i) => (
              <EventRow key={`hist-${h.id}-${i}`} ev={ev} />
            )),
          )}

        <div ref={bottomRef} />
      </div>

      {/* 底部预算条 */}
      <BudgetBar traceEvents={traceEvents} />
    </div>
  );
}

/** 底部预算条：从事件流提取 tokens / cost / duration / 状态 */
function BudgetBar({ traceEvents }: { traceEvents: TraceEvent[] }) {
  let tokens: number | null = null;
  let costFen: number | null = null;
  let hit = false;
  let hitReason: string | null = null;

  for (const ev of traceEvents) {
    if (ev.type === "budget.hit") {
      hit = true;
      hitReason = (ev.payload?.reason as string) ?? null;
    }
    const p = ev.payload as Record<string, unknown> | undefined;
    if (ev.type === "agent.done" || ev.type === "agent.failed") {
      if (typeof p?.tokens === "number") tokens = p.tokens;
      if (typeof p?.cost === "number") costFen = p.cost;
    }
  }

  const startedAt = traceEvents[0]?.ts ?? Date.now();
  const lastTs = traceEvents[traceEvents.length - 1]?.ts ?? startedAt;
  const elapsed = fmtDuration(lastTs - startedAt);
  const isFailed = traceEvents.some((e) => e.type === "agent.failed");

  if (traceEvents.length === 0) return null;

  return (
    <div className="flex h-[22px] flex-none items-center gap-2 border-t border-line bg-bg2/60 px-3 font-mono text-[10px]">
      <span className="text-tx3">duration</span>
      <span className="text-tx2 tabular-nums">{elapsed}</span>

      {tokens !== null && (
        <>
          <span className="text-tx3">·</span>
          <span className="text-tx3">tokens</span>
          <span className="text-tx2 tabular-nums">{fmtK(tokens)}</span>
        </>
      )}

      {costFen !== null && costFen > 0 && (
        <>
          <span className="text-tx3">·</span>
          <span className="text-tx3">cost</span>
          <span className="text-warn tabular-nums">¥{(costFen / 100).toFixed(2)}</span>
        </>
      )}

      {/* 右侧状态 */}
      <span className="ml-auto flex items-center gap-2">
        {hit && (
          <span className="text-err">
            ⚠ budget hit{hitReason ? ` · ${hitReason}` : ""}
          </span>
        )}
        {!hit && isFailed && <span className="text-err">✗ failed</span>}
        {!hit && !isFailed && traceEvents.length > 0 && (
          <span className="text-tx3">{traceEvents.length} ev</span>
        )}
      </span>
    </div>
  );
}
