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
      const calls: {
        toolCallId: string;
        name: string;
        argumentsText: string;
        toolMessage?: MessageDto;
      }[] = m.toolCalls.map((tc: ToolCallRef) => ({
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
    // search.multi 专用：跨源计数 + 降级标注
    if (j && typeof j === "object" && "query" in j && ("github" in j || "web" in j || "kb" in j)) {
      const parts: string[] = [];
      if (Array.isArray(j.web)) parts.push(`网页 ${j.web.length}`);
      if (Array.isArray(j.github)) parts.push(`GitHub ${j.github.length}`);
      if (Array.isArray(j.kb)) parts.push(`知识库 ${j.kb.length}`);
      if (Array.isArray(j.degraded) && j.degraded.length > 0) parts.push(`降级 ${j.degraded.length}`);
      return parts.length > 0 ? `统一检索 · ${parts.join(" · ")}` : "统一检索 · 无结果";
    }
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
          {hasResult && call.name === "search.multi" ? (
            <MultiSearchCards content={call.toolMessage!.content} />
          ) : hasResult ? (
            <div>
              <div className="text-tx3">// result</div>
              <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all text-tx2">{prettyJson(call.toolMessage!.content, 800)}</pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Hook：把消息流自动分组 */
export function useGroupedMessages(messages: MessageDto[]) {
  return useMemo(() => groupMessages(messages), [messages]);
}

// ── search.multi 专用结果卡 ─────────────────────────────

interface MultiGhItem {
  fullName: string;
  description: string | null;
  stars: number;
  language: string | null;
  pushedAt: string;
  archived: boolean;
  url: string;
}
interface MultiWebItem {
  title: string;
  url: string;
  snippet: string;
}
interface MultiKbItem {
  title: string;
  snippet: string;
}

function relShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const day = Math.floor(diff / 86400000);
  if (day < 1) return "今天";
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** search.multi 展开态：GitHub 行卡 + 网页 / 知识库行 */
function MultiSearchCards({ content }: { content: string }) {
  let data: {
    web?: MultiWebItem[] | null;
    github?: MultiGhItem[] | null;
    kb?: MultiKbItem[] | null;
    degraded?: string[];
  } | null = null;
  try {
    data = JSON.parse(content);
  } catch {
    /* fallthrough */
  }
  if (!data || typeof data !== "object") {
    return (
      <div>
        <div className="text-tx3">// result</div>
        <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all text-tx2">{prettyJson(content, 800)}</pre>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {data.github && data.github.length > 0 && (
        <div>
          <div className="mb-1 text-tx3">// GitHub 仓库 ({data.github.length})</div>
          <ul className="space-y-1">
            {data.github.map((g) => (
              <li key={g.fullName} className="rounded border border-line bg-bg px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <a
                    href={g.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate font-bold text-acc hover:underline"
                  >
                    {g.fullName}
                  </a>
                  {g.archived && (
                    <span className="flex-none rounded border border-warn/40 px-1 text-[9px] text-warn">归档</span>
                  )}
                  <span className="flex-none text-[10px] text-tx3">↗</span>
                </div>
                {g.description && <div className="mt-0.5 truncate text-[10px] text-tx3">{g.description}</div>}
                <div className="mt-0.5 flex gap-3 text-[9.5px] text-tx3">
                  {g.language && <span>● {g.language}</span>}
                  <span>★ {g.stars >= 1000 ? `${(g.stars / 1000).toFixed(1)}k` : g.stars}</span>
                  <span>pushed {relShort(g.pushedAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.web && data.web.length > 0 && (
        <div>
          <div className="mb-1 text-tx3">// 网页 ({data.web.length})</div>
          <ul className="space-y-0.5">
            {data.web.map((w, i) => (
              <li key={`${w.url}-${i}`} className="flex items-baseline gap-2 text-[10.5px]">
                <span className="flex-none text-tx3">[{hostOf(w.url)}]</span>
                <a
                  href={w.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-tx2 hover:text-acc hover:underline"
                >
                  {w.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.kb && data.kb.length > 0 && (
        <div>
          <div className="mb-1 text-tx3">// 知识库 ({data.kb.length})</div>
          <ul className="space-y-0.5">
            {data.kb.map((k, i) => (
              <li key={`${k.title}-${i}`} className="text-[10.5px] text-tx2">
                <span className="text-tx3">[kb]</span> {k.title}
                <span className="text-tx3"> — {k.snippet.slice(0, 60)}…</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.degraded && data.degraded.length > 0 && (
        <div className="rounded border border-warn/40 bg-warn/5 px-2 py-1 text-[10px] text-warn">
          部分数据源降级：{data.degraded.join("；")}
        </div>
      )}
      {!data.github?.length && !data.web?.length && !data.kb?.length && (
        <div className="text-[10.5px] text-tx3">// 无结果</div>
      )}
    </div>
  );
}
