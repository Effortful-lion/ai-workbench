import { useEffect, useState, type FormEvent } from "react";
import type { ModelDto } from "@aiwb/shared";
import { api } from "../lib/api";
import { displayName, useAuthStore } from "../stores/auth";
import { canOpenPanel } from "../lib/panel-access";
import { usePublicOwner } from "../lib/public-owner";
import type { PanelId } from "../stores/panel";
import { useChatStore } from "../stores/chat";
import { usePanelStore } from "../stores/panel";
import { useUiStore } from "../stores/ui";
import { useAuthModal } from "../stores/auth-modal";
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

/** 首页提问历史：本地留存最近 6 条，点击可重发 */
const HISTORY_KEY = "aiwb-hero-history";
const HISTORY_MAX = 6;

function loadHistory(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string").slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

/** 打字机占位文案：前四条对齐原型 PHS，末条覆盖统计分析场景 */
const PHS = [
  "问我任何事，或输入 / 调用工作台能力…",
  "试试：把今天的邮件汇总成三句话",
  "试试：在知识库里找 qdrant 配置",
  "试试：新建一个每日站会 Agent",
  "试试：分析这周的访问统计",
];

/**
 * 原型 phLoop 的等价实现：逐字打出 → 停顿 → 回删 → 下一条。
 * active=false（输入框有内容）时立即停止并清空；尊重 reduced-motion 只显示首条。
 */
function useTypedPlaceholder(active: boolean): string {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!active) {
      setTyped("");
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTyped(PHS[0]);
      return;
    }
    let alive = true;
    let timer = 0;
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, ms);
      });

    void (async () => {
      let idx = 0;
      while (alive) {
        const t = PHS[idx++ % PHS.length];
        for (let i = 1; i <= t.length && alive; i += 1) {
          setTyped(t.slice(0, i));
          await sleep(42);
        }
        if (!alive) break;
        await sleep(1800);
        // 与原型一致：全部删空（含首字）再进入下一条
        for (let i = t.length - 1; i >= 0 && alive; i -= 1) {
          setTyped(t.slice(0, i));
          await sleep(14);
        }

        await sleep(300);
      }
    })();

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [active]);

  return typed;
}

/** 游客可直接浏览的展示型模块：面板 id → 公开只读页（需要站点主人 username） */
const PUBLIC_PAGES: Partial<Record<PanelId, (username: string) => string>> = {
  blog: (u) => `/b/${encodeURIComponent(u)}`,
  resume: (u) => `/p/${encodeURIComponent(u)}`,
  tools: (u) => `/t/${encodeURIComponent(u)}`,
};

/** 首屏启动行：直接完整渲染，不再逐字打出（刷新/切回首页零等待） */
function bootLines(who: string): string[] {
  const d = new Date();
  const ts = d.toTimeString().slice(0, 8);
  return [
    `${who}@workbench ~ $ wb init`,
    `[ok] session · ${d.toLocaleDateString("sv-SE")} ${ts}`,
    "[ok] workbench · 知识库 · Agent · 工具链 就绪",
  ];
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
  const requireLogin = useAuthModal((s) => s.requireLogin);
  // 游客：公开模块直接跳公开页，需要站点主人 username
  const publicOwner = usePublicOwner(!user);
  const [text, setText] = useState("");
  const [modelCount, setModelCount] = useState<number | null>(null);
  const [history, setHistory] = useState<string[]>(loadHistory);
  // 招呼语拆成「前缀 + 昵称（异色）+ 感叹号」；首帧直接完整渲染，不再逐字打出
  const greetHead = `${greeting()}，`;
  // 游客没有账号名，用「访客」占位
  const name = user ? displayName(user) : "访客";
  const boot = bootLines(user?.username || "guest");
  // 输入框为空时打占位文案（首屏立即开始，不再等待开场动画）
  const typedPh = useTypedPlaceholder(text.length === 0);
  // 有内容时占位符不可见，保留基础文案；空输入时跟随打字进度（删空间隙只留空）
  const placeholder = text ? PHS[0] : typedPh ? `${typedPh}▌` : "";

  const remember = (q: string) => {
    const next = [q, ...history.filter((x) => x !== q)].slice(0, HISTORY_MAX);
    setHistory(next);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
      // 隐私模式写入失败不影响提问
    }
  };

  const clearHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      // 同上
    }
  };

  useEffect(() => {
    // 游客不请求模型列表（需要登录），也就没有「N 个模型在线」的说法
    if (!user) {
      setModelCount(null);
      return;
    }
    api<ModelDto[]>("/models")
      .then((ms) => setModelCount(ms.filter((m) => m.status === "ok").length))
      .catch(() => setModelCount(null));
  }, [user]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (!q || streaming) return;
    // 游客：原地弹登录，输入内容保留，登录后可直接回车发送
    if (!user) {
      requireLogin("登录后即可开始对话");
      return;
    }
    remember(q);
    send(q);
    setText("");
  };

  /** 执行一条斜杠命令 */
  const handleCmd = (c: Command) => {
    // 游客：命令涉及面板/会话/登录态，统一引导登录（保留已输入的文本）
    if (!user) {
      requireLogin("登录后可使用命令与面板");
      return;
    }
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

  // panel 字段用于按角色收口（危险面板只给 owner），无 panel 的入口（CLI）始终可见
  const entries: { label: string; run: () => void; panel?: PanelId }[] = [
    { label: "模型管理", panel: "models", run: () => openPanel("models") },
    { label: "AI 助手", panel: "agents", run: () => openPanel("agents") },
    { label: "执行历史", panel: "history", run: () => openPanel("history") },
    { label: "访问统计", panel: "stats", run: () => openPanel("stats") },
    { label: "知识库", panel: "kb", run: () => openPanel("kb") },
    { label: "博客", panel: "blog", run: () => openPanel("blog") },
    { label: "项目管理", panel: "projects", run: () => openPanel("projects") },
    { label: "代码管理", panel: "code", run: () => openPanel("code") },
    { label: "日程管理", panel: "cal", run: () => openPanel("cal") },
    { label: "邮件管理", panel: "mail", run: () => openPanel("mail") },
    { label: "站内信", panel: "notify", run: () => openPanel("notify") },
    { label: "商业化管理", panel: "biz", run: () => openPanel("biz") },
    { label: "客户管理", panel: "crm", run: () => openPanel("crm") },
    { label: "流水线工厂", panel: "pipe", run: () => openPanel("pipe") },
    { label: "个人简历", panel: "resume", run: () => openPanel("resume") },
    { label: "百宝箱", panel: "tools", run: () => openPanel("tools") },
    { label: "工具管理", panel: "aitools", run: () => openPanel("aitools") },
    { label: "GitHub 观察窗", panel: "gh", run: () => openPanel("gh") },
    { label: "CLI 终端", run: () => setCli(true) },
  ];
  // 普通用户只隐藏危险入口，其余全部可见（数据由服务端指向 admin）
  const visibleEntries = entries.filter((c) => !c.panel || canOpenPanel(c.panel, user?.role));

  /** MinIO Web 控制台入口：按当前 host 推导（端口 9701），让用户知道工作台自带对象存储 */
  const minioConsoleUrl = `${window.location.protocol}//${window.location.hostname}:9701`;

  return (
    // 外层负责滚动：横屏（视口矮）内容超出一屏时可上下滚动；内层 min-h-full 保证内容短时仍垂直居中
    <div className="h-full overflow-y-auto px-6">
      <div className="mx-auto flex min-h-full w-[min(720px,100%)] flex-col justify-center gap-6 py-6 landscape:gap-8">
      {/* 启动行：静态完整展示，不再逐行打出 */}
      <div className="min-h-[68px] w-full font-mono text-[12px] leading-[1.9] text-tx3">
        {boot.map((line, i) => (
          <div key={i} className="truncate">
            {line.startsWith("[ok] ") ? (
              <>
                <span className="text-acc">[ok]</span>
                {line.slice(4)}
              </>
            ) : (
              line
            )}
          </div>
        ))}
      </div>

      <div className="text-left">
        <div className="font-mono text-[13px] text-tx3">
          {new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })}
        </div>
        <h1 className="mt-2 min-h-[38px] text-[28px] font-bold tracking-wide">
          {greetHead}
          <span className="text-acc">{name}</span>！
        </h1>
        <div className="mt-2 font-mono text-[12px] text-tx3">
          {!user
            ? "// 只读浏览 · 登录后即可开始对话"
            : modelCount === null
              ? "// 工作台已就绪"
              : modelCount > 0
                ? `// ${modelCount} 个模型在线 · 对话通道已就绪`
                : "// 尚未有可用模型 · 先打开模型管理接入一个"}
        </div>
      </div>

      <form onSubmit={submit} className="w-[min(720px,100%)]">
        <div className="relative">
          <div className="flex items-center gap-2.5 rounded-lg border border-line bg-bg1 px-4 py-4 transition-[border-color,box-shadow] duration-150 focus-within:border-acc focus-within:shadow-[var(--glow)]">
            <span className="flex-none font-mono text-[14px] text-acc">›</span>
            <input
              className="flex-1 bg-transparent font-mono text-[14px] text-tx caret-acc outline-none placeholder:text-tx3"
              placeholder={placeholder}
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
            />
            <kbd className="flex-none rounded border border-line px-1.5 py-[3px] font-mono text-[10.5px] text-tx3">⏎</kbd>
            <kbd className="flex-none rounded border border-line px-1.5 py-[3px] font-mono text-[10.5px] text-tx3">⌘K</kbd>
          </div>
          {/* 首页输入框在页面中部，命令列表向下展开 */}
          <CommandSuggest text={text} onPick={handleCmd} onClose={() => setText("")} direction="down" />
        </div>
        {/* 模型可切换但不可管理：user 有 models:use（列表 + 选择），管理面板仍归 admin；游客不展示 */}
        {user && (
          <div className="mt-6 font-mono text-[11px]">
            <div className="mb-2.5 text-tx3">// 模型 ◎ 自动 = 服务端默认 · 与聊天栏联动</div>
            <ModelPicker value={modelId} onChange={setModel} align="left" />
          </div>
        )}
      </form>

      {/* 两组快捷区：入口（开模块/外部服务）与问题（问 AI） */}
      <div className="w-[min(720px,100%)] space-y-6">
        <section>
          <h2 className="mb-2.5 font-mono text-[11px] text-tx3">// 快捷入口</h2>
          <div className="flex flex-wrap gap-2">
            {visibleEntries.map((c) => (
              <button
                key={c.label}
                className="rounded border border-line bg-bg1 px-3 py-1.5 font-mono text-[12px] text-tx2 transition-colors hover:border-acc hover:text-acc"
                onClick={() => {
                  if (user) {
                    c.run();
                    return;
                  }
                  // 游客：展示型模块直接看公开页；站内信 / GitHub / CLI 才需要登录
                  const toPublic = c.panel ? PUBLIC_PAGES[c.panel] : undefined;
                  if (toPublic && publicOwner) {
                    window.location.assign(toPublic(publicOwner.username));
                    return;
                  }
                  requireLogin(`登录后可使用「${c.label}」`);
                }}
              >
                {c.label}
              </button>
            ))}
            {/* 游客：联系我公开页（/c/:username），与登录用户的顶栏入口等价 */}
            {!user && publicOwner && (
              <a
                href={`/c/${encodeURIComponent(publicOwner.username)}`}
                className="rounded border border-acc/40 bg-bg1 px-3 py-1.5 font-mono text-[12px] text-acc transition-colors hover:border-acc hover:bg-acc/10"
              >
                联系我
              </a>
            )}
            {/* 对象存储控制台用管理员凭据登录，普通用户没有账号，入口只对 owner 展示 */}
            {user?.role === "owner" && (
              <a
                href={minioConsoleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-acc/40 bg-bg1 px-3 py-1.5 font-mono text-[12px] text-acc transition-colors hover:border-acc hover:bg-acc/10"
                title={`打开对象存储控制台（${minioConsoleUrl}，账号与网站管理员一致）`}
              >
                ↗ 对象存储
              </a>
            )}
          </div>
        </section>

        {/* 本地提问历史属于登录用户：游客不展示，避免点了必然要登录 */}
        {user && history.length > 0 && (
          <section>
            <div className="mb-2.5 flex items-center gap-2">
              <h2 className="font-mono text-[11px] text-tx3">// 最近提问</h2>
              <button
                className="font-mono text-[10px] text-tx3 transition-colors hover:text-err"
                onClick={clearHistory}
                title="清空本地提问历史"
              >
                清空
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {history.map((q) => (
                <button
                  key={q}
                  className="group flex max-w-full items-center gap-1.5 rounded border border-line bg-bg1 px-3 py-1.5 font-mono text-[12px] text-tx2 transition-colors hover:border-acc hover:text-acc"
                  onClick={() => {
                    remember(q);
                    send(q);
                  }}
                  title={`再次提问：${q}`}
                >
                  <span className="truncate">{q}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
      </div>
    </div>
  );
}

