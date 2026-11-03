import { useMemo, useState } from "react";
import type { MessageDto, ToolCallRef } from "@aiwb/shared";

/** 分组后的渲染单元：要么是普通消息，要么是一轮 tool call */
export type RenderGroup =
  | { kind: "message"; message: MessageDto }
  | {
      kind: "tool-call";
      /** 发起工具调用的 assistant 消息（content 通常是 "(工具调用)"） */
      assistantId: string;
      calls: {
        toolCallId: string;
        name: string;
        argumentsText: string;
        toolMessage?: MessageDto;
      }[];
    };

/** 消息流 → 渲染单元流：把 assistant(toolCalls) + 后续 tool(toolCallId) 合并成 ToolCallBlock */
export function groupMessages(messages: MessageDto[]): RenderGroup[] {
  const out: RenderGroup[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    // assistant 带原生 tool_calls → 收集后续 tool 消息合并进去
    if (m.role === "assistant" && m.toolCalls?.length) {
      const calls = m.toolCalls.map((tc: ToolCallRef) => ({
        toolCallId: tc.id,
        name: tc.name,
        argumentsText: tc.arguments ?? "{}",
      }));
      // 扫后续 tool 消息，匹配 id
      let j = i + 1;
      let consumed = 0;
      while (j < messages.length && messages[j].role === "tool") {
        const t = messages[j];
        const match = calls.find((c) => c.toolCallId === t.toolCallId);
        if (match) {
          match.toolMessage = t;
          consumed++;
          j++;
        } else {
          break; // tool 没对应 assistant toolCalls → 旧指令式或孤立消息，停止扫描
        }
      }
      out.push({ kind: "tool-call", assistantId: m.id, calls });
      i += 1 + consumed;
      continue;
    }
    out.push({ kind: "message", message: m });
    i++;
  }
  return out;
}

/** 美化 arguments / result JSON：尝试 JSON.parse，失败返回原文 */
function prettyJson(text: string, maxLen = 400): string {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    const pretty = JSON.stringify(parsed, null, 2);
    if (pretty.length > maxLen) return pretty.slice(0, maxLen) + "\n…(已截断)";
    return pretty;
  } catch {
    if (trimmed.length > maxLen) return trimmed.slice(0, maxLen) + "…(已截断)";
    return trimmed;
  }
}

/** 提取工具结果的摘要（显示在折叠头上） */
function resultSummary(content: string): string {
  const trimmed = content.trim();
  try {
    const j = JSON.parse(trimmed);
    if (Array.isArray(j)) return `${j.length} 项`;
    if (j && typeof j === "object") {
      // 挑几个常见字段做摘要
      const keys = Object.keys(j);
      if (keys.length === 0) return "空对象";
      // 取 1-2 个关键值
      const picks: string[] = [];
      for (const k of keys.slice(0, 2)) {
        const v = j[k];
        if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") {
          picks.push(`${k}=${String(v).slice(0, 30)}`);
        }
      }
      if (picks.length) return picks.join(", ");
      return `${keys.length} 字段`;
    }
  } catch { /* fallthrough */ }
  return trimmed.slice(0, 60);
}

/** 一条工具调用块（可折叠显示 arguments + result） */
export function ToolCallBlock({ calls }: { calls: { toolCallId: string; name: string; argumentsText: string; toolMessage?: MessageDto }[] }) {
  return (
    <div className="my-1 flex flex-col gap-1.5">
      {calls.map((c) => (
        <ToolCallItem key={c.toolCallId} call={c} />
      ))}
    </div>
  );
}

function ToolCallItem({ call }: { call: { toolCallId: string; name: string; argumentsText: string; toolMessage?: MessageDto } }) {
  const [expanded, setExpanded] = useState(false);
  const hasResult = !!call.toolMessage;
  const ok = hasResult && !call.toolMessage!.content?.includes('"ok":false') && !call.toolMessage!.content?.includes('"error"');

  return (
    <div className="overflow-hidden rounded border border-dashed border-acc/30 bg-bg1/70 px-3 py-1.5 font-mono text-[11px]">
      {/* 折叠头：flex 子元素必须加 min-w-0 才能让 truncate 生效 */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full min-w-0 items-center gap-2 text-left hover:text-acc"
      >
        <span className="flex-none text-acc">{expanded ? "▾" : "▸"}</span>
        <span className="flex-none text-warn">tool</span>
        <span className="flex-none text-acc">{call.name}</span>
        <span className="min-w-0 flex-1 truncate text-tx3">
          ({prettyJson(call.argumentsText, 120)})
        </span>
        {hasResult && (
          <span className={`flex-none truncate max-w-[45%] ${ok ? "text-acc" : "text-err"}`}>
            {ok ? "✓" : "✗"}
            {call.toolMessage?.content ? ` ${resultSummary(call.toolMessage.content)}` : ""}
          </span>
        )}
        {!hasResult && <span className="flex-none text-tx3">pending…</span>}
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="mt-1.5 ml-5 min-w-0 space-y-1.5 border-l border-line pl-3 text-[11px]">
          <div>
            <div className="text-tx3">// arguments</div>
            <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all text-tx2">{prettyJson(call.argumentsText)}</pre>
          </div>
          {hasResult && (
            <div>
              <div className="text-tx3">// result</div>
              <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all text-tx2">{prettyJson(call.toolMessage!.content, 800)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Hook：把消息流自动分组 */
export function useGroupedMessages(messages: MessageDto[]) {
  return useMemo(() => groupMessages(messages), [messages]);
}
