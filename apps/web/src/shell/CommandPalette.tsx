import { useEffect, useMemo, useRef, useState } from "react";
import { useAuthStore } from "../stores/auth";
import { useChatStore } from "../stores/chat";
import { PANEL_META, usePanelStore, type PanelId } from "../stores/panel";
import { useUiStore } from "../stores/ui";
import { useConfirmStore } from "../stores/confirm";

interface Cmd {
  kind: "导航" | "动作" | "AI";
  label: string;
  keywords: string;
  run: () => void;
}

const KIND_ICON: Record<Cmd["kind"], string> = { 导航: "▸", 动作: "⚡", AI: "✦" };

/** ⌘K 命令面板：导航 / 动作 / AI 三类混排，模糊过滤 */
export default function CommandPalette() {
  const { paletteOpen, setPalette, toggleTheme, setCli } = useUiStore();
  const { openPanel, closeAll } = usePanelStore();
  const { send, newChat, disconnect } = useChatStore();
  const clearAuth = useAuthStore((s) => s.clear);
  const [q, setQ] = useState("");
  const [ix, setIx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Cmd[]>(() => {
    const nav: Cmd[] = (Object.keys(PANEL_META) as PanelId[]).map((id) => ({
      kind: "导航",
      label: `打开${PANEL_META[id].title}`,
      keywords: `${id} ${PANEL_META[id].path} open`,
      run: () => openPanel(id),
    }));
    const actions: Cmd[] = [
      { kind: "动作", label: "新对话", keywords: "new chat", run: () => newChat() },
      {
        kind: "动作",
        label: "回到对话首页",
        keywords: "home hero",
        run: () => {
          newChat();
          closeAll();
          setCli(false);
        },
      },
      { kind: "动作", label: "进入 CLI", keywords: "cli terminal 终端", run: () => setCli(true) },
      { kind: "动作", label: "切换主题色系", keywords: "theme dark warm 主题", run: () => toggleTheme() },
      {
        kind: "动作",
        label: "退出登录",
        keywords: "logout quit",
        run: () =>
          useConfirmStore.getState().ask({
            title: "退出登录",
            message: "确定要退出当前账号吗？",
            confirmText: "⏎ 退出",
            onConfirm: () => {
              disconnect();
              closeAll();
              clearAuth();
            },
          }),
      },
    ];
    return [...nav, ...actions];
  }, [openPanel, newChat, closeAll, setCli, toggleTheme, clearAuth, disconnect]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(t) || c.keywords.toLowerCase().includes(t),
    );
  }, [commands, q]);

  // AI 兜底：无精确匹配时给出「问 AI」
  const items = useMemo<Cmd[]>(() => {
    const t = q.trim();
    if (!t) return filtered;
    const ask: Cmd = { kind: "AI", label: `问 AI「${t}」`, keywords: "", run: () => send(t) };
    return [...filtered, ask];
  }, [filtered, q, send]);

  useEffect(() => {
    if (paletteOpen) {
      setQ("");
      setIx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [paletteOpen]);

  useEffect(() => setIx(0), [q]);

  if (!paletteOpen) return null;

  const runItem = (c: Cmd) => {
    setPalette(false);
    c.run();
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center bg-black/40 pt-[14vh]"
      onClick={() => setPalette(false)}
    >
      <div
        className="w-[min(560px,92%)] overflow-hidden rounded-lg border border-line bg-bg1 font-mono shadow-[0_8px_40px_rgba(0,0,0,0.45)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <span className="text-acc">⌘</span>
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-[13px] text-tx outline-none placeholder:text-tx3"
            placeholder="输入命令、模块名，或直接问 AI…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setPalette(false);
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setIx((i) => Math.min(i + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIx((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && items[ix]) runItem(items[ix]);
            }}
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-tx3">esc</kbd>
        </div>
        <div className="max-h-[320px] overflow-y-auto py-1">
          {items.length === 0 && <div className="px-3 py-4 text-[12px] text-tx3">// 无匹配命令</div>}
          {items.map((c, i) => (
            <div
              key={`${c.kind}-${c.label}`}
              className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-[12px] ${
                i === ix ? "bg-bg2 text-acc" : "text-tx2"
              }`}
              onMouseEnter={() => setIx(i)}
              onClick={() => runItem(c)}
            >
              <span className={i === ix ? "text-acc" : "text-tx3"}>{KIND_ICON[c.kind]}</span>
              <span className="w-8 text-[10px] text-tx3">{c.kind}</span>
              <span className="truncate">{c.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
