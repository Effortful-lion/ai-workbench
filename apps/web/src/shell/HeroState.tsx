import { useEffect, useState, type FormEvent } from "react";
import type { ModelDto } from "@aiwb/shared";
import { api } from "../lib/api";
import { useAuthStore } from "../stores/auth";
import { useChatStore } from "../stores/chat";
import { usePanelStore } from "../stores/panel";
import { useUiStore } from "../stores/ui";
import { useConfirmStore } from "../stores/confirm";
import CommandSuggest from "./CommandSuggest";
import ModelPicker from "./ModelPicker";
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
  // 与聊天栏顶部选择器同源的模型状态（pendingModelId 每轮随 send 携带）
  const modelId = useChatStore((s) => s.pendingModelId);
  const setModel = useChatStore((s) => s.setModel);
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
          useConfirmStore.getState().ask({
            title: "退出登录",
            message: "确定要退出当前账号吗？",
            confirmText: "⏎ 退出",
            onConfirm: () => {
              disconnect();
              logout();
            },
          });
          break;
      }
    }
  };

  const entries: { label: string; run: () => void }[] = [
    { label: "模型管理", run: () => openPanel("models") },
    { label: "AI 助手", run: () => openPanel("agents") },
    { label: "执行历史", run: () => openPanel("history") },
    { label: "访问统计", run: () => openPanel("stats") },
    { label: "知识库", run: () => openPanel("kb") },
    { label: "项目管理", run: () => openPanel("projects") },
    { label: "代码管理", run: () => openPanel("code") },
    { label: "日程管理", run: () => openPanel("cal") },
    { label: "邮件管理", run: () => openPanel("mail") },
    { label: "站内信", run: () => openPanel("notify") },
    { label: "商业化管理", run: () => openPanel("biz") },
    { label: "客户管理", run: () => openPanel("crm") },
    { label: "流水线工厂", run: () => openPanel("pipe") },
    { label: "个人简历", run: () => openPanel("resume") },
    { label: "百宝箱", run: () => openPanel("tools") },
    { label: "工具管理", run: () => openPanel("aitools") },
    { label: "GitHub 观察窗", run: () => openPanel("gh") },
    { label: "CLI 终端", run: () => setCli(true) },
  ];

  /** MinIO Web 控制台入口：按当前 host 推导（端口 9701），让用户知道工作台自带对象存储 */
  const minioConsoleUrl = `${window.location.protocol}//${window.location.hostname}:9701`;

  const questions: { label: string; run: () => void }[] = [
    { label: "你能做什么？", run: () => send("你能做什么？") },
    { label: "介绍一下这个工作台", run: () => send("介绍一下这个工作台") },
  ];

  return (
    // 外层负责滚动：横屏（视口矮）内容超出一屏时可上下滚动；内层 min-h-full 保证内容短时仍垂直居中
    <div className="h-full overflow-y-auto px-6">
      <div className="mx-auto flex min-h-full w-[min(720px,100%)] flex-col items-center justify-center gap-6 py-6 landscape:gap-8">
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
        {/* 模型选择：注释行风格，与聊天栏共用 store 状态 */}
        <div className="mt-2 flex flex-col items-start gap-2 font-mono text-[11px]">
          {/* 注释行在上 */}
          <div className="text-tx3">// 模型 ◎ 自动 = 服务端默认 · 与聊天栏联动</div>
          {/* ModelPicker 独占一行 */}
          <div>
            <ModelPicker value={modelId} onChange={setModel} align="left" />
          </div>
        </div>
      </form>

      {/* 两组快捷区：入口（开模块/外部服务）与问题（问 AI） */}
      <div className="w-[min(720px,100%)] space-y-5">
        <section>
          <h2 className="mb-2.5 font-mono text-[11px] text-tx3">// 快捷入口</h2>
          <div className="flex flex-wrap gap-2">
            {entries.map((c) => (
              <button
                key={c.label}
                className="rounded border border-line bg-bg1 px-3 py-1.5 font-mono text-[12px] text-tx2 transition-colors hover:border-acc hover:text-acc"
                onClick={c.run}
              >
                {c.label}
              </button>
            ))}
            <a
              href={minioConsoleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-acc/40 bg-bg1 px-3 py-1.5 font-mono text-[12px] text-acc transition-colors hover:border-acc hover:bg-acc/10"
              title={`打开对象存储控制台（${minioConsoleUrl}，账号与网站管理员一致）`}
            >
              ↗ 对象存储
            </a>
          </div>
        </section>

        <section>
          <h2 className="mb-2.5 font-mono text-[11px] text-tx3">// 猜你想问</h2>
          <div className="flex flex-wrap gap-2">
            {questions.map((c) => (
              <button
                key={c.label}
                className="rounded border border-line bg-bg1 px-3 py-1.5 font-mono text-[12px] text-tx2 transition-colors hover:border-acc hover:text-acc"
                onClick={c.run}
              >
                {c.label}
              </button>
            ))}
          </div>
        </section>
      </div>
      </div>
    </div>
  );
}

