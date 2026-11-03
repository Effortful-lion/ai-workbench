import { useEffect, useState, type FormEvent } from "react";
import type { ModelDto } from "@aiwb/shared";
import { api } from "../lib/api";
import { useAuthStore } from "../stores/auth";
import { useChatStore } from "../stores/chat";
import { usePanelStore } from "../stores/panel";
import { useUiStore } from "../stores/ui";
import CommandSuggest from "./CommandSuggest";
import type { Command } from "../lib/commands";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "夜深了";
  if (h < 12) return "早上好";
  if (h < 18) return "下午好";
  return "晚上好";
}

/** 状态 A · 对话态：招呼语 + 巨型输入框 + 动态 chips */
export default function HeroState() {
  const user = useAuthStore((s) => s.user);
  const send = useChatStore((s) => s.send);
  const streaming = useChatStore((s) => s.streaming);
  const newChat = useChatStore((s) => s.newChat);
  const openPanel = usePanelStore((s) => s.openPanel);
  const closeAll = usePanelStore((s) => s.closeAll);
  const setCli = useUiStore((s) => s.setCli);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const logout = useAuthStore((s) => s.clear);
  const disconnect = useChatStore((s) => s.disconnect);
  const [text, setText] = useState("");
  const [modelCount, setModelCount] = useState<number | null>(null);

  useEffect(() => {
    api<ModelDto[]>("/models")
      .then((ms) => setModelCount(ms.filter((m) => m.status === "ok").length))
      .catch(() => setModelCount(null));
  }, []);

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
      openPanel(c.panel);
    } else {
      switch (c.action) {
        case "new":
          newChat();
          break;
        case "clear":
          newChat();
          break;
        case "cli":
          setCli(true);
          break;
        case "home":
          setCli(false);
          closeAll();
          newChat();
          break;
        case "theme":
          toggleTheme();
          break;
        case "help":
          send("你能做什么？");
          break;
        case "logout":
          disconnect();
          logout();
          break;
      }
    }
  };

  const chips: { label: string; run: () => void }[] = [
    { label: "▸ 打开模型管理", run: () => openPanel("models") },
    { label: "▸ 打开 AI 助手", run: () => openPanel("agents") },
    { label: "▸ 打开执行历史", run: () => openPanel("history") },
    { label: "▸ 打开访问统计", run: () => openPanel("stats") },
    { label: "▸ 打开知识库", run: () => openPanel("kb") },
    { label: "▸ 打开项目管理", run: () => openPanel("projects") },
    { label: "▸ 打开代码管理", run: () => openPanel("code") },
    { label: "▸ 打开日程管理", run: () => openPanel("cal") },
    { label: "▸ 打开邮件管理", run: () => openPanel("mail") },
    { label: "▸ 打开站内信", run: () => openPanel("notify") },
    { label: "▸ 打开商业化管理", run: () => openPanel("biz") },
    { label: "▸ 打开客户管理", run: () => openPanel("crm") },
    { label: "▸ 打开流水线工厂", run: () => openPanel("pipe") },
    { label: "▸ 打开个人简历", run: () => openPanel("resume") },
    { label: "▸ 打开百宝箱", run: () => openPanel("tools") },
    { label: "▸ 打开工具管理", run: () => openPanel("aitools") },
    { label: "▸ 进入 CLI", run: () => setCli(true) },
    { label: "▸ 你能做什么？", run: () => send("你能做什么？") },
    { label: "▸ 介绍一下这个工作台", run: () => send("介绍一下这个工作台") },
  ];

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <div className="font-mono text-[13px] text-tx3">
          {new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })}
        </div>
        <h1 className="mt-2 text-[28px] font-bold tracking-wide">
          {greeting()}，<span className="text-acc">{user?.username}</span>！
        </h1>
        <div className="mt-2 font-mono text-[12px] text-tx3">
          {modelCount === null
            ? "// 工作台已就绪"
            : modelCount > 0
              ? `// ${modelCount} 个模型在线 · 对话通道已就绪`
              : "// 尚未有可用模型 · 先打开模型管理接入一个"}
        </div>
      </div>

      <form onSubmit={submit} className="w-[min(720px,100%)]">
        <div className="relative">
          <div className="flex items-center gap-3 rounded-lg border border-line bg-bg1 px-4 py-4 transition-shadow focus-within:border-acc focus-within:shadow-[0_0_12px_color-mix(in_srgb,var(--acc)_13%,transparent)]">
            <span className="font-mono text-acc">▸</span>
            <input
              className="flex-1 bg-transparent font-mono text-[15px] text-tx outline-none placeholder:text-tx3"
              placeholder="问我任何事，或输入 / 调用工作台能力…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
            />
            <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-tx3">⏎</kbd>
          </div>
          <CommandSuggest text={text} onPick={handleCmd} onClose={() => setText("")} />
        </div>
      </form>

      <div className="flex flex-wrap justify-center gap-2">
        {chips.map((c) => (
          <button
            key={c.label}
            className="rounded border border-line bg-bg1 px-3 py-1.5 font-mono text-[12px] text-tx2 transition-colors hover:border-acc hover:text-acc"
            onClick={c.run}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
