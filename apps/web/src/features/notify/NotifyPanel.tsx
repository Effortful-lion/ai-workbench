import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  NotificationDigestDto,
  NotificationDto,
  NotificationScanResult,
  NotificationType,
} from "@aiwb/shared";
import { api } from "../../lib/api";
import { useAuthStore } from "../../stores/auth";
import { usePanelStore } from "../../stores/panel";

const TYPE_META: Record<NotificationType, { label: string; icon: string; cls: string }> = {
  system: { label: "系统", icon: "⚙", cls: "border-line text-tx3" },
  schedule: { label: "日程", icon: "⏱", cls: "border-warn/50 text-warn" },
  mail: { label: "邮件", icon: "✉", cls: "border-acc/60 text-acc" },
  blog: { label: "博客", icon: "▤", cls: "border-acc/60 text-acc" },
};

const TYPE_FILTERS: { id: NotificationType | "all"; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "system", label: "系统" },
  { id: "schedule", label: "日程" },
  { id: "mail", label: "邮件" },
  { id: "blog", label: "博客" },
];

const pad = (n: number) => String(n).padStart(2, "0");

function fmtWhen(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function BellIcon() {
  return (
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
  );
}

/** 站内信 / 通知中心：系统消息 + 日程提醒 + 重要邮件 */
export default function NotifyPanel() {
  const role = useAuthStore((s) => s.user?.role ?? "guest");
  // 原型 ACL：~/notify owner rw / member rw / guest ×
  const canAccess = role !== "guest";
  const canWrite = canAccess;
  const openPanel = usePanelStore((s) => s.openPanel);

  const [digest, setDigest] = useState<NotificationDigestDto | null>(null);
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [typeFilter, setTypeFilter] = useState<NotificationType | "all">("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = useMemo(
    () => items.find((n) => n.id === selectedId) ?? null,
    [items, selectedId],
  );

  const reload = useCallback(async () => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    try {
      const [dig, list] = await Promise.all([
        api<NotificationDigestDto>("/notify/digest"),
        api<NotificationDto[]>("/notify/notifications"),
      ]);
      setDigest(dig);
      setItems(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [canAccess]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((n) => {
      if (typeFilter !== "all" && n.type !== typeFilter) return false;
      if (unreadOnly && n.isRead) return false;
      if (q && !`${n.title}\n${n.body}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, typeFilter, unreadOnly, query]);

  const openItem = async (n: NotificationDto) => {
    setSelectedId(n.id);
    if (n.isRead || !canWrite) return;
    try {
      const next = await api<NotificationDto>(`/notify/notifications/${n.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isRead: true }),
      });
      setItems((prev) => prev.map((x) => (x.id === next.id ? next : x)));
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleRead = async (n: NotificationDto) => {
    try {
      const next = await api<NotificationDto>(`/notify/notifications/${n.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isRead: !n.isRead }),
      });
      setItems((prev) => prev.map((x) => (x.id === next.id ? next : x)));
      setNotice(`✓ ${next.isRead ? "已标为已读" : "已标为未读"}`);
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeItem = async (n: NotificationDto) => {
    try {
      await api(`/notify/notifications/${n.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((x) => x.id !== n.id));
      if (selectedId === n.id) setSelectedId(null);
      setNotice("✓ 已删除该站内信");
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const runScan = async () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const r = await api<NotificationScanResult>("/notify/scan", { method: "POST" });
      setNotice(
        r.created > 0
          ? `✓ 扫描完成：新增 ${r.created} 条（日程 ${r.schedule} · 邮件 ${r.mail}）· 跳过 ${r.skipped} 条`
          : `✓ 扫描完成：没有新的提醒（跳过 ${r.skipped} 条）`,
      );
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runReadAll = async () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const r = await api<{ updated: number }>("/notify/read-all", { method: "POST" });
      setNotice(`✓ 已把 ${r.updated} 条标为已读`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!canAccess) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 font-mono text-[12px] text-tx3">
        <div className="text-err">403 · ~/notify 仅登录用户可访问</div>
        <div>// 原型 ACL：owner rw · member rw · guest ×</div>
        <div>// 站内信按用户隔离，AI 助手同样受角色权限限制</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[12px] text-tx3">
        ⠋ 读取 ~/notify…
      </div>
    );
  }

  const typeCount = (t: NotificationType) => digest?.types[t] ?? 0;

  return (
    <div className="mx-auto w-[min(1280px,97%)] py-4 font-mono">
      {/* 顶部：铃铛 + 红点 + 未读数 */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="relative inline-flex h-6 w-6 items-center justify-center rounded border border-line text-tx2"
            title={digest?.unread ? `${digest.unread} 条未读` : "站内信"}
          >
            <BellIcon />
            {(digest?.unread ?? 0) > 0 && (
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-err shadow-[0_0_6px_var(--err)]" />
            )}
          </span>
          <span className="text-[12px] text-tx2">
            <b className={`font-medium ${(digest?.unread ?? 0) > 0 ? "text-err" : "text-tx3"}`}>
              {digest?.unread ?? 0}
            </b>{" "}
            未读
          </span>
          <span className="text-[10px] text-tx3">
            {digest?.total ?? 0} 条 · 今日 {digest?.today ?? 0}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px]">
          <button
            className="rounded border border-line px-2 py-0.5 text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
            onClick={() => void runReadAll()}
            disabled={busy || (digest?.unread ?? 0) === 0}
          >
            全部已读
          </button>
          <button
            className="rounded border border-line px-2 py-0.5 text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
            onClick={() => void runScan()}
            disabled={busy}
          >
            {busy ? "⠋ 扫描中" : "扫描提醒"}
          </button>
        </div>
      </div>

      {/* 过滤 */}
      <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-line pb-2 text-[11px]">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.id}
            className={`rounded border px-1.5 py-0.5 ${
              typeFilter === f.id ? "border-acc text-acc" : "border-line text-tx3 hover:border-acc"
            }`}
            onClick={() => setTypeFilter(f.id)}
          >
            {f.label}
            {f.id !== "all" && <span className="ml-1 text-[10px] text-tx3">{typeCount(f.id)}</span>}
          </button>
        ))}
        <button
          className={`rounded border px-1.5 py-0.5 ${
            unreadOnly ? "border-acc text-acc" : "border-line text-tx3 hover:border-acc"
          }`}
          onClick={() => setUnreadOnly((v) => !v)}
        >
          unread
        </button>
        <input
          className="ml-auto w-[180px] rounded border border-line bg-bg1 px-2 py-0.5 text-[11px] text-tx outline-none placeholder:text-tx3 focus:border-acc"
          placeholder="grep 标题/正文…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {notice && <div className="mb-2 text-[11px] text-acc">{notice}</div>}
      {error && (
        <div className="mb-2 rounded border border-err/50 bg-bg1 px-3 py-2 text-[12px] text-err">
          ✗ {error}
        </div>
      )}

      {/* 列表 + 阅读窗 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)]">
        <div className="min-w-0 overflow-hidden rounded-lg border border-line bg-bg1">
          <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[10.5px] text-tx3">
            <span>~/notify/inbox</span>
            <span>
              {visible.length} shown · {items.length} total
            </span>
          </div>
          {visible.length === 0 ? (
            <div className="px-4 py-12 text-center text-[12px] text-tx3">
              {items.length === 0
                ? "// 还没有站内信 —— 有新提醒时系统会自动投递到这里"
                : "// 当前过滤条件没有匹配的站内信"}
            </div>
          ) : (
            <div className="max-h-[560px] overflow-y-auto">
              {visible.map((n) => {
                const on = selectedId === n.id;
                const meta = TYPE_META[n.type];
                return (
                  <div
                    key={n.id}
                    className={`grid cursor-pointer grid-cols-[72px_52px_minmax(0,1fr)] items-baseline gap-2.5 border-b border-line px-2.5 py-2.5 transition-colors ${
                      on ? "bg-bg2" : "hover:bg-bg2"
                    }`}
                    onClick={() => void openItem(n)}
                  >
                    <span className="text-[10.5px] text-tx3">{fmtWhen(n.createdAt)}</span>
                    <span className={`justify-self-start rounded border px-1.5 py-[1px] text-[9.5px] ${meta.cls}`}>
                      {meta.icon} {meta.label}
                    </span>
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-baseline gap-1">
                        {!n.isRead && <span className="flex-none text-acc">●</span>}
                        <span className={`truncate text-[12.5px] ${on ? "text-acc" : n.isRead ? "text-tx2" : "text-tx"}`}>
                          {n.title}
                        </span>
                      </span>
                     {n.body && <span className="mt-0.5 block truncate text-[11px] text-tx3">{n.body}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="border-t border-line px-3 py-1.5 text-[10px] text-tx3">
            // 点击自动标记已读 · 扫描按 dedupeKey 幂等 · 站内信按用户隔离
          </div>
        </div>

        {/* 详情 */}
        <div className="min-w-0 overflow-hidden rounded-lg border border-line bg-bg1">
          <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[10.5px] text-tx3">
            <span>~/notify/{selected ? "message" : "reader"}</span>
            {selected && (
              <button
                className="text-tx3 hover:text-err"
                onClick={() => setSelectedId(null)}
              >
                × 关闭
              </button>
            )}
          </div>
          {!selected ? (
            <div className="px-4 py-16 text-center text-[11px] text-tx3">
              // 选择左侧站内信查看详情
              <br />
              // 日程 / 邮件类型可跳转对应面板
            </div>
          ) : (
            <div className="max-h-[560px] overflow-y-auto p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="break-words text-[14px] text-tx">{selected.title}</div>
                  <div className="mt-1 text-[10.5px] text-tx3">
                    {selected.type} · {new Date(selected.createdAt).toLocaleString("zh-CN")}
                  </div>
                </div>
                <span className={`flex-none rounded border px-1.5 py-[1px] text-[9.5px] ${TYPE_META[selected.type].cls}`}>
                  {TYPE_META[selected.type].label}
                </span>
              </div>

              <div className="mt-3 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-tx2">
                {selected.body || "（无正文）"}
              </div>

              {canWrite && (
                <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-line pt-2 text-[10px]">
                  <button
                    className="rounded border border-line px-1.5 py-0.5 text-tx2 hover:border-acc hover:text-acc"
                    onClick={() => void toggleRead(selected)}
                  >
                    {selected.isRead ? "标为未读" : "标为已读"}
                  </button>
                  {selected.sourceId && selected.type === "schedule" && (
                    <button
                      className="rounded border border-line px-1.5 py-0.5 text-tx2 hover:border-acc hover:text-acc"
                      onClick={() => openPanel("cal")}
                    >
                      → 打开日程
                    </button>
                  )}
                  {selected.sourceId && selected.type === "mail" && (
                    <button
                      className="rounded border border-line px-1.5 py-0.5 text-tx2 hover:border-acc hover:text-acc"
                      onClick={() => openPanel("mail")}
                    >
                      → 打开邮件
                    </button>
                  )}
                  <button
                    className="rounded border border-err/50 px-1.5 py-0.5 text-err hover:bg-err/10"
                    onClick={() => void removeItem(selected)}
                  >
                    删除
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 text-[10px] text-tx3">
        // 站内信由系统投递（系统公告 · 日程提醒 · 重要未读邮件）· 点开自动标记已读
      </div>
    </div>
  );
}
