import { useEffect, useState } from "react";
import type { NotificationDigestDto } from "@aiwb/shared";
import { useAuthStore } from "../stores/auth";
import { useChatStore } from "../stores/chat";
import { usePanelStore } from "../stores/panel";
import { useUiStore } from "../stores/ui";
import { api } from "../lib/api";

export default function TopBar() {
  const { user, refreshToken, clear } = useAuthStore();
  const { theme, toggleTheme, setPalette } = useUiStore();
  const connected = useChatStore((s) => s.connected);
  const disconnect = useChatStore((s) => s.disconnect);
  const closeAll = usePanelStore((s) => s.closeAll);
  const openPanel = usePanelStore((s) => s.openPanel);
  const [unread, setUnread] = useState(0);

  // 铃铛红点：轮询站内信未读数
  useEffect(() => {
    if (!user) {
      setUnread(0);
      return;
    }
    let alive = true;
    const load = () => {
      api<NotificationDigestDto>("/notify/digest")
        .then((d) => {
          if (alive) setUnread(d.unread);
        })
        .catch(() => {
          if (alive) setUnread(0);
        });
    };
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [user]);

  const home = () => {
    useUiStore.getState().setCli(false);
    closeAll();
    useChatStore.getState().newChat();
  };

  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) });
    } finally {
      disconnect();
      closeAll();
      clear();
    }
  };

  return (
    <header className="flex h-[52px] flex-none items-center justify-between border-b border-line px-4 font-mono">
      <button
        onClick={home}
        title="回到首页"
        className="flex items-center text-[13px] font-bold tracking-wider hover:text-acc transition-colors"
      >
        <span className="text-acc">⌘</span> AI-WORKBENCH
        <span className="ml-2 text-[10px] font-normal text-tx3">v0.1</span>
      </button>
      <div className="flex items-center gap-3 text-[11px] text-tx2">
        <button
          className="flex h-[26px] items-center gap-1.5 rounded border border-line px-2 py-1 hover:border-acc hover:text-acc"
          onClick={() => setPalette(true)}
          title="命令面板"
        >
          <span className="text-acc">⌘</span>K
        </button>
        <button
          className="relative flex h-[26px] items-center justify-center rounded border border-line px-2 py-1 hover:border-acc hover:text-acc"
          onClick={() => openPanel("notify")}
          title={unread > 0 ? `${unread} 条未读站内信` : "站内信"}
        >
          <svg
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M3.5 11.5h9l-1-1.6V7a3.5 3.5 0 0 0-7 0v2.9l-1 1.6Z" />
            <path d="M6.4 13a1.7 1.7 0 0 0 3.2 0" />
          </svg>
          {unread > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-err px-1 text-[9px] leading-none text-bg">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
        <span title={connected ? "对话通道已连接" : "对话通道断开"}>
          <span className={connected ? "text-acc" : "text-err"}>●</span>
        </span>
        <button
          className="flex h-[26px] items-center justify-center rounded border border-line px-2 py-1 hover:border-acc hover:text-acc"
          onClick={toggleTheme}
          title="切换主题色系"
        >
          {theme === "dark" ? "◐" : "◑"}
        </button>
        <span className="flex h-[26px] items-center rounded border border-line px-2 py-1">
          <span className="text-acc">{user?.username}</span>
          <span className="text-tx3"> [{user?.role}]</span>
        </span>
        <button
          className="flex h-[26px] items-center justify-center rounded border border-line px-2 py-1 hover:border-err hover:text-err"
          onClick={logout}
          title="退出登录"
        >
          ✗
        </button>
      </div>
    </header>
  );
}
