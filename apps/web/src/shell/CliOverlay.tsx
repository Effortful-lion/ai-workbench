import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "../stores/auth";
import { PANEL_META, usePanelStore, type PanelId } from "../stores/panel";
import { useUiStore, type Theme } from "../stores/ui";

interface Line {
  text: string;
  cls?: "acc" | "err" | "dim";
}

const BANNER: Line[] = [
  { text: "AI-WORKBENCH · tty1 · 占位终端（xterm.js 将在 agents 模块接入）", cls: "dim" },
  { text: "输入 help 查看命令集。", cls: "dim" },
];

/** 状态 C · CLI 沉浸态（占位实现：等宽缓冲 + 基础命令集） */
export default function CliOverlay() {
  const user = useAuthStore((s) => s.user);
  const { setCli, setTheme, theme } = useUiStore();
  const openPanel = usePanelStore((s) => s.openPanel);
  const [lines, setLines] = useState<Line[]>(BANNER);
  const [buf, setBuf] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const prompt = `workbench@${user?.username ?? "guest"}:~$`;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  const print = (ls: Line[]) => setLines((prev) => [...prev, ...ls]);

  const exec = (raw: string) => {
    const input = raw.trim();
    print([{ text: `${prompt} ${input}` }]);
    if (!input) return;
    const [cmd, ...args] = input.split(/\s+/);

    switch (cmd) {
      case "help":
        print([
          { text: "命令集（一期范围，见总体设计 §8.4）：", cls: "dim" },
          { text: "  help                 本帮助" },
          { text: "  whoami               当前用户" },
          { text: "  open <module>        打开模块面板（models|agents|kb|resume|tools）" },
          { text: "  theme [dark|warm]    查看/切换色系" },
          { text: "  clear                清屏" },
          { text: "  exit                 退出 CLI（esc 同效）" },
        ]);
        break;
      case "whoami":
        print([{ text: `${user?.username} [${user?.role}]`, cls: "acc" }]);
        break;
      case "open": {
        const id = args[0] as PanelId | undefined;
        if (id && id in PANEL_META) {
          print([{ text: `▸ 打开面板 ${PANEL_META[id].path}`, cls: "acc" }]);
          openPanel(id);
          setCli(false);
        } else {
          print([{ text: `open: 未知模块「${args[0] ?? ""}」· 可选: ${Object.keys(PANEL_META).join("|")}`, cls: "err" }]);
        }
        break;
      }
      case "theme": {
        const t = args[0] as Theme | undefined;
        if (t === "dark" || t === "warm") {
          setTheme(t);
          print([{ text: `▸ 色系已切换 → ${t}`, cls: "acc" }]);
        } else {
          print([{ text: `当前色系: ${theme}（theme dark|warm 切换）` }]);
        }
        break;
      }
      case "clear":
        setLines([]);
        break;
      case "exit":
        setCli(false);
        break;
      default:
        print([{ text: `${cmd}: command not found · 输入 help`, cls: "err" }]);
    }
  };

  return (
    <div
      className="flex h-full flex-col bg-bg font-mono"
      onClick={() => inputRef.current?.focus()}
      onKeyDown={(e) => e.key === "Escape" && setCli(false)}
      tabIndex={-1}
    >
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[13px] leading-relaxed">
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.cls === "acc" ? "text-acc" : l.cls === "err" ? "text-err" : l.cls === "dim" ? "text-tx3" : "text-tx"
            }
          >
            {l.text}
          </div>
        ))}
        <div className="flex items-center">
          <span className="mr-2 text-acc">{prompt}</span>
          <span className="text-tx">{buf}</span>
          <span className="animate-blink text-acc">▌</span>
        </div>
      </div>
      {/* 真实输入框（透明，仅收键盘） */}
      <input
        ref={inputRef}
        className="sr-only"
        value={buf}
        autoFocus
        onChange={(e) => setBuf(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            exec(buf);
            setBuf("");
          }
        }}
      />
      <div className="flex-none border-t border-line px-4 py-1.5 text-[10px] text-tx3">
        esc 退出 · 这是占位终端，agent/流式输出将在模块 4 接入
      </div>
    </div>
  );
}
