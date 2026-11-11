import { useEffect, useRef, useState } from "react";
import type {
  ContactChannel,
  ContactChannelType,
  ContactProfile,
  MailDigestDto,
  NotificationDigestDto,
  OwnContactDto,
} from "@aiwb/shared";
import { displayName, useAuthStore } from "../stores/auth";
import { useChatStore } from "../stores/chat";
import { usePanelStore } from "../stores/panel";
import { useUiStore } from "../stores/ui";
import { useToastStore } from "../stores/toast";
import { useConfirmStore } from "../stores/confirm";
import { api } from "../lib/api";
import { Icon } from "../lib/icons";
import { useAuthModal } from "../stores/auth-modal";
import NicknameDialog from "./NicknameDialog";

const CONTACT_LABEL: Record<ContactChannelType, string> = {
  email: "邮箱",
  github: "GitHub",
  website: "主页",
  booking: "预约",
  wechat: "微信",
  phone: "电话",
};

const CONTACT_ICON: Record<ContactChannelType, string> = {
  email: "✉",
  github: "◈",
  website: "⌂",
  booking: "◷",
  wechat: "◍",
  phone: "☎",
};

export default function TopBar() {
  const { user, clear } = useAuthStore();
  const { theme, toggleTheme, setPalette } = useUiStore();
  const connected = useChatStore((s) => s.connected);
  const disconnect = useChatStore((s) => s.disconnect);
  const closeAll = usePanelStore((s) => s.closeAll);
  const openPanel = usePanelStore((s) => s.openPanel);
  const requireLogin = useAuthModal((s) => s.requireLogin);
  const [unread, setUnread] = useState(0);
  const [mailUnread, setMailUnread] = useState(0);
  const [nickOpen, setNickOpen] = useState(false);
  // 邮件管理归站点主人，普通用户不轮询也不显示入口
  const isOwner = user?.role === "owner";

  // 红点：轮询站内信 / 邮件未读数；面板刷新摘要会广播 aiwb:notify-changed / aiwb:mail-changed，即时同步
  useEffect(() => {
    if (!user) {
      setUnread(0);
      setMailUnread(0);
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
      if (!isOwner) return;
      api<MailDigestDto>("/mail/digest")
        .then((d) => {
          if (alive) setMailUnread(d.unread);
        })
        .catch(() => {
          if (alive) setMailUnread(0);
        });
    };
    const onMailChanged = (e: Event) => {
      const n = (e as CustomEvent<{ unread?: number }>).detail?.unread;
      if (typeof n === "number") setMailUnread(n);
    };
    // 站内信面板读/删/全部已读后广播，红点无需等下一轮轮询
    const onNotifyChanged = (e: Event) => {
      const n = (e as CustomEvent<{ unread?: number }>).detail?.unread;
      if (typeof n === "number") setUnread(n);
    };
    void load();
    window.addEventListener("aiwb:mail-changed", onMailChanged);
    window.addEventListener("aiwb:notify-changed", onNotifyChanged);
    // 切回页面时立即校准（在别的窗口/标签里读过站内信也能马上消红点）
    window.addEventListener("focus", load);
    const timer = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", load);
      window.removeEventListener("aiwb:mail-changed", onMailChanged);
      window.removeEventListener("aiwb:notify-changed", onNotifyChanged);
    };
  }, [user]);

  const home = () => {
    useUiStore.getState().setCli(false);
    closeAll();
    useChatStore.getState().newChat();
  };

  const logout = async () => {
    try {
      // refresh token 在 httpOnly Cookie 里，服务端按 Cookie 注销并清除
      await api("/auth/logout", { method: "POST", body: "{}" });
    } finally {
      disconnect();
      closeAll();
      clear();
    }
  };

  // 游客顶栏：只保留品牌、主题与登录入口；站内信/邮件/昵称都要求登录
  if (!user) {
    return (
      <header className="flex h-[52px] flex-none items-center justify-between border-b border-line px-4 font-mono">
        <button
          onClick={home}
          title="回到首页"
          className="flex items-center text-[13px] font-bold tracking-wider transition-colors hover:text-acc"
        >
          <img
            src="/icons/icon-32.png"
            alt=""
            className="mr-2 h-[18px] w-[18px] rounded-[3px] border border-line"
          />
          AI-WORKBENCH
          <span className="ml-2 hidden text-[10px] font-normal text-tx3 sm:inline">v0.1</span>
        </button>
        <div className="flex items-center gap-1.5 text-[11px] sm:gap-3">
          <span className="hidden text-[10px] text-tx3 sm:inline">只读浏览</span>
          <button
            className="flex h-[26px] items-center justify-center rounded border border-line px-2 py-1 hover:border-acc hover:text-acc"
            onClick={toggleTheme}
            title="切换主题色系"
          >
            {theme === "dark" ? "◐" : "◑"}
          </button>
          <button
            className="flex h-[26px] items-center gap-1.5 rounded border border-acc/50 px-2.5 py-1 text-acc transition-colors hover:border-acc hover:bg-acc/10"
            onClick={() => requireLogin("登录后可开始对话、使用面板与发表评论")}
            title="登录 / 注册"
          >
            登录 / 注册
            <Icon name="next" size={11} />
          </button>
        </div>
      </header>
    );
  }

  return (
    <header className="flex h-[52px] flex-none items-center justify-between border-b border-line px-4 font-mono">
      <button
        onClick={home}
        title="回到首页"
        className="flex items-center text-[13px] font-bold tracking-wider hover:text-acc transition-colors"
      >
        <img
          src="/icons/icon-32.png"
          alt=""
          className="mr-2 h-[18px] w-[18px] rounded-[3px] border border-line"
        />
        AI-WORKBENCH
        <span className="ml-2 hidden text-[10px] font-normal text-tx3 sm:inline">v0.1</span>
      </button>
      <div className="flex items-center gap-1.5 text-[11px] text-tx2 sm:gap-3">
        <button
          className="hidden h-[26px] items-center gap-1.5 rounded border border-line px-2 py-1 hover:border-acc hover:text-acc sm:flex"
          onClick={() => setPalette(true)}
          title="命令面板"
        >
          <span className="text-acc">⌘</span>K
        </button>
        {isOwner && (
        <button
          className="relative flex h-[26px] items-center justify-center rounded border border-line px-2 py-1 hover:border-acc hover:text-acc"
          onClick={() => openPanel("mail")}
          title={mailUnread > 0 ? `${mailUnread} 封未读邮件` : "邮件管理"}
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
            <rect x="2.5" y="4" width="11" height="8" rx="1" />
            <path d="m3 4.6 5 3.6 5-3.6" />
          </svg>
          {mailUnread > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-err px-1 text-[9px] leading-none text-bg">
              {mailUnread > 99 ? "99+" : mailUnread}
            </span>
          )}
        </button>
        )}
        {/* 联系方式属于站点主人：所有登录用户都能看到「如何联系我」 */}
        {user && <ContactBadge username={user.username} />}
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
        <button
          className="hidden h-[26px] items-center rounded border border-line px-2 py-1 hover:border-acc md:flex"
          onClick={() => setNickOpen(true)}
          title={`${displayName(user)} · @${user?.username ?? ""} · 点击修改昵称`}
        >
          <span className="max-w-[120px] truncate text-acc">{displayName(user)}</span>
          <span className="text-tx3"> [{user?.role}]</span>
        </button>
        <button
          className="flex h-[26px] items-center justify-center rounded border border-line px-2 py-1 hover:border-err hover:text-err"
          onClick={() =>
            useConfirmStore.getState().ask({
              title: "退出登录",
              message: `确定要退出当前账号（${user?.username ?? ""}）吗？`,
              confirmText: "⏎ 退出",
              onConfirm: () => void logout(),
            })
          }
          title="退出登录"
        >
          ✗
        </button>
      </div>
      {nickOpen && <NicknameDialog onClose={() => setNickOpen(false)} />}
    </header>
  );
}

/** 顶栏联系入口：hover / focus 出预览卡（绝对定位不撑高顶栏），点击或回车进 /c/:username */
function ContactBadge({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState<ContactProfile | null>(null);
  // /profile/contact 对普通用户返回的是站点主人的资料，跳转要用它的 username
  const [page, setPage] = useState(username);
  // 触屏没有 hover：不做预览，点击直接进公开页
  const [coarse] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(hover: none)").matches
      : false,
  );
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    api<OwnContactDto>("/profile/contact")
      .then((d) => {
        if (!alive) return;
        setContact(d.contact);
        if (d.username) setPage(d.username);
      })
      .catch(() => {
        // 读取失败静默：预览卡退回默认文案，公开页仍可正常打开
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open]);

  const go = () => {
    window.location.href = `/c/${encodeURIComponent(page)}`;
  };

  const copy = (text: string) => {
    const write = navigator.clipboard?.writeText(text);
    if (!write) {
      useToastStore.getState().push("当前浏览器不支持自动复制", "warn");
      return;
    }
    write.then(
      () => useToastStore.getState().push("已复制到剪贴板"),
      () => useToastStore.getState().push("复制失败，请手动选择", "warn"),
    );
  };

  const publicChannels = (contact?.channels ?? [])
    .filter((c) => c.visibility === "public")
    .slice(0, 4);
  const preferred = contact?.preferred ?? "email";
  const preferredLabel = CONTACT_LABEL[preferred];

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={() => {
        if (!coarse) setOpen(true);
      }}
      onMouseLeave={() => {
        if (!coarse) setOpen(false);
      }}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        className="flex h-[26px] items-center justify-center rounded border border-line px-2 py-1 hover:border-acc hover:text-acc"
        onClick={go}
        title="如何联系我"
        aria-haspopup="dialog"
        aria-expanded={open && !coarse}
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
          <rect x="2" y="3.5" width="12" height="9" rx="1.2" />
          <circle cx="6" cy="7.4" r="1.4" />
          <path d="M3.8 10.8c.5-1.1 1.3-1.6 2.2-1.6s1.7.5 2.2 1.6" />
          <path d="M10.4 6.6h2.2M10.4 8.4h2.2M10.4 10.2h1.4" />
        </svg>
      </button>

      {open && !coarse && (
        <div
          role="button"
          tabIndex={0}
          onClick={go}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              go();
            }
          }}
          className="absolute right-0 top-full z-50 mt-2 w-[304px] cursor-pointer rounded-lg border border-line bg-bg1 p-3 text-left shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] tracking-wider text-tx3">如何联系我</span>
            <span className="text-[9px] text-tx3">/c/{page} ↗</span>
          </div>

          <div className="mt-2 rounded border border-acc/20 bg-acc/5 px-2.5 py-2 text-[10px] text-tx2">
            首选 <b className="font-medium text-acc">{preferredLabel}</b> · 通常{" "}
            <b className="font-medium text-acc">{contact?.responseTime ?? "1 个工作日内"}</b> 回复
          </div>

          <div className="mt-2 space-y-1.5">
            {publicChannels.length === 0 ? (
              <div className="py-1 text-[10px] text-tx3">// 尚未填写公开渠道</div>
            ) : (
              publicChannels.map((c: ContactChannel) => (
                <div key={c.type} className="flex items-center gap-2 text-[10.5px]">
                  <span className="w-[14px] flex-none text-center text-tx3">{CONTACT_ICON[c.type]}</span>
                  <span className="flex-none text-tx3">{CONTACT_LABEL[c.type]}</span>
                  <span className="min-w-0 flex-1 truncate text-tx">{c.value}</span>
                  {c.type === "email" && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        copy(c.value);
                      }}
                      className="flex-none rounded border border-line px-1.5 text-[9px] text-tx3 hover:border-acc hover:text-acc"
                    >
                      复制
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="mt-2 border-t border-line pt-2 text-[9px] text-tx3">
            点击查看完整公开页 · Enter 打开 · Esc 关闭
          </div>
        </div>
      )}
    </div>
  );
}
