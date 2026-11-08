import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useChatStore } from "../stores/chat";
import { useAgentsStore } from "../stores/agents";
import { usePanelStore } from "../stores/panel";
import { useUiStore } from "../stores/ui";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";
import { MarkdownText } from "../lib/markdown";
import type { ModelDto } from "@aiwb/shared";
import CommandSuggest from "./CommandSuggest";
import TracePanel from "../features/chat/TracePanel";
import { ToolCallBlock, groupMessages, type RenderGroup } from "../features/chat/ToolCallBlock";
import type { Command } from "../lib/commands";

const STATUS_DOT: Record<ModelDto["status"], string> = {
  ok: "bg-acc",
  error: "bg-err",
  untested: "bg-tx3",
};

/** 状态 B · 对话列：始终在场的人机通道 */
export default function ChatColumn() {
  const {
    conversations, currentId, messages, streaming, streamBuf, error, pendingAgentId, pendingModelId,
    send, stop, openConversation, removeConversation, newChat, startAgentChat, setModel,
  } = useChatStore();
  const { agents, load: loadAgents } = useAgentsStore();
  const [models, setModels] = useState<ModelDto[]>([]);
  const [text, setText] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadAgents();
    void api<ModelDto[]>("/models").then(setModels).catch(() => setModels([]));
  }, [loadAgents]);

  // 当前会话绑定的 Agent（新会话看 pending，已有会话看绑定）
  const currentAgentId = currentId
    ? (conversations.find((c) => c.id === currentId)?.agentId ?? null)
    : pendingAgentId;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamBuf, error]);

  const groups = useMemo(() => groupMessages(messages), [messages]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || streaming) return;
    send(text);
    setText("");
  };

  /** 执行一条斜杠命令 */
  const handleCmd = (c: Command) => {
    setText("");
    if (c.kind === "panel") {
      usePanelStore.getState().openPanel(c.panel);
    } else {
      switch (c.action) {
        case "new":
        case "clear":
          newChat();
          break;
        case "cli":
          useUiStore.getState().setCli(true);
          break;
        case "home":
          useUiStore.getState().setCli(false);
          usePanelStore.getState().closeAll();
          newChat();
          break;
        case "theme":
          useUiStore.getState().toggleTheme();
          break;
        case "help":
          send("你能做什么？");
          break;
        case "logout":
          useChatStore.getState().disconnect();
          useAuthStore.getState().clear();
          break;
      }
    }
  };

  return (
    <div className="relative flex h-full flex-col">
      {/* 栏头 */}
      <div className="flex h-[38px] flex-none items-center gap-2 border-b border-line px-3 font-mono text-[11px] text-tx3">
        <span className="flex-none">~/chat</span>
        {/* 模型选择器：切换对话模型（长名截断，状态灯紧贴其右） */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <select
            className="min-w-0 cursor-pointer truncate rounded border border-line bg-bg1 px-1 py-0.5 text-[10px] text-tx2 outline-none hover:border-acc focus:border-acc"
            style={{ maxWidth: 220 }}
            value={pendingModelId ?? ""}
            onChange={(e) => setModel(e.target.value || null)}
            title="选择对话模型（不选则用默认模型，切换后下一条消息生效）"
          >
            <option value="">
              ◎ 自动（{models.find((m) => m.isDefault)?.modelName ?? "服务端挑选"}）
            </option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.provider}/{m.modelName}
                {m.isDefault ? " ★" : ""}
              </option>
            ))}
          </select>
          {pendingModelId && (() => {
            const m = models.find((x) => x.id === pendingModelId);
            if (!m) return null;
            return (
              <span
                className={`inline-block h-2 w-2 flex-none rounded-full ${STATUS_DOT[m.status]}`}
                title={`${m.provider}/${m.modelName} · ${m.status}`}
              />
            );
          })()}
          {/* Agent 选择器 */}
          <select
            className="min-w-0 flex-none cursor-pointer truncate rounded border border-line bg-bg1 px-1 py-0.5 text-[10px] text-tx2 outline-none hover:border-acc focus:border-acc"
            style={{ maxWidth: 120 }}
            value={currentAgentId ?? ""}
            onChange={(e) => startAgentChat(e.target.value || null)}
            title="选择 Agent（切换后开启新会话）"
          >
            <option value="">◐ 通用助手</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                ◑ {a.name}
              </option>
            ))}
          </select>
        </div>
        {/* 右侧：固定宽度，不参与挤占 */}
        <div className="flex flex-none items-center gap-1.5">
          <button className="px-0.5 hover:text-acc" onClick={() => setShowHistory((v) => !v)} title="历史会话">
            ▤
          </button>
          <button className="px-0.5 hover:text-acc" onClick={newChat} title="新会话">
            ＋
          </button>
        </div>
      </div>

      {/* 历史会话抽屉 */}
      {showHistory && (
        <div className="absolute inset-x-0 top-[38px] z-10 max-h-[60%] overflow-y-auto border-b border-line bg-bg1 font-mono text-[12px]">
          {conversations.length === 0 && (
            <div className="px-3 py-4 text-tx3">// 暂无历史会话</div>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`group flex cursor-pointer items-center justify-between px-3 py-2 hover:bg-bg2 ${
                c.id === currentId ? "text-acc" : "text-tx2"
              }`}
              onClick={() => {
                void openConversation(c.id);
                setShowHistory(false);
              }}
            >
              <span className="truncate">
                {c.id === currentId ? "▸" : "·"} {c.title}
              </span>
              <button
                className="invisible ml-2 text-tx3 group-hover:visible hover:text-err"
                onClick={(e) => {
                  e.stopPropagation();
                  void removeConversation(c.id);
                }}
              >
                ✗
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 消息流 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !streaming && (
          <div className="mt-10 text-center font-mono text-[12px] text-tx3">
            // 空会话 · 说点什么开始
          </div>
        )}
        <div className="mx-auto flex max-w-[760px] min-w-0 flex-col gap-4">
          {groups.map((g) => {
            if (g.kind === "tool-call") {
              return (
                <div key={`tc-${g.assistantId}`} className="min-w-0">
                  <div className="mb-1 font-mono text-[10px] text-warn">tool ›</div>
                  <ToolCallBlock calls={g.calls} />
                </div>
              );
            }
            const m = g.message;
            return (
              <div key={m.id} className="min-w-0">
                <div
                  className={`mb-1 font-mono text-[10px] ${
                    m.role === "user" ? "text-tx3" : m.role === "tool" ? "text-warn" : "text-acc"
                  }`}
                >
                  {m.role === "user" ? "you ›" : m.role === "tool" ? "tool ›" : "ai ›"}
                </div>
                {m.role === "tool" ? (
                  <div className="whitespace-pre-wrap break-words rounded border border-dashed border-warn/40 bg-bg1 px-3 py-2 font-mono text-[12px] leading-relaxed text-tx2">
                    {m.content}
                  </div>
                ) : m.role === "user" ? (
                  <div className="whitespace-pre-wrap break-words rounded border border-line bg-bg1 px-3 py-2 text-[13px] leading-relaxed text-tx">
                    {m.content}
                  </div>
                ) : (
                  <div className="rounded border border-line bg-bg1 px-3 py-2 text-[13px] leading-relaxed text-tx">
                    <MarkdownText text={m.content} />
                  </div>
                )}
              </div>
            );
          })}
          {streaming && (
            <div>
              <div className="mb-1 font-mono text-[10px] text-acc">ai ›</div>
              <div className="rounded border border-acc/40 bg-bg1 px-3 py-2 text-[13px] leading-relaxed text-tx">
                <MarkdownText text={streamBuf} />
                <span className="animate-blink font-mono text-acc">▌</span>
              </div>
            </div>
          )}
          {error && (
            <div className="rounded border border-err/50 bg-bg1 px-3 py-2 font-mono text-[12px] text-err">
              ✗ {error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* 输入框 */}
      <form onSubmit={submit} className="flex-none border-t border-line p-3">
        <div className="relative mx-auto flex max-w-[760px] items-center gap-2 rounded border border-line bg-bg1 px-3 py-2.5 focus-within:border-acc">
          <span className="font-mono text-acc">▸</span>
          <input
            className="flex-1 bg-transparent font-mono text-[13px] text-tx outline-none placeholder:text-tx3"
            placeholder={streaming ? "AI 正在输出…" : "继续对话…（⏎ 发送，输入 / 调命令）"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={streaming}
          />
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              className="flex h-6 flex-none items-center gap-1 rounded border border-err/60 bg-err/10 px-2 font-mono text-[10px] text-err transition-colors hover:bg-err/20"
              title="停止生成（保留已输出内容）"
            >
              ■ 停止
            </button>
          ) : (
            <span className="font-mono text-[10px] text-tx3">⏎</span>
          )}
          <CommandSuggest text={text} onPick={handleCmd} onClose={() => setText("")} />
        </div>
      </form>

      {/* Trace 迹线面板 */}
      <TracePanel />
    </div>
  );
}
