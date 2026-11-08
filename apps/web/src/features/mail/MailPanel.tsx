import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  MailAccountDto,
  MailAttachmentDto,
  MailAccountTestResult,
  MailCategory,
  MailDigestDto,
  MailFolder,
  MailMessageDto,
  MailSyncResult,
} from "@aiwb/shared";
import { MAIL_PROVIDER_PRESETS } from "@aiwb/shared";
import { api, apiBlob } from "../../lib/api";
import { useAuthStore } from "../../stores/auth";

const FOLDERS: { id: MailFolder; label: string }[] = [
  { id: "inbox", label: "inbox" },
  { id: "sent", label: "sent" },
  { id: "drafts", label: "drafts" },
  { id: "trash", label: "trash" },
];

const CAT_META: Record<MailCategory, { label: string; cls: string }> = {
  important: { label: "重要", cls: "border-acc/60 text-acc" },
  subscription: { label: "订阅", cls: "border-line text-tx3" },
  spam: { label: "垃圾", cls: "border-err/50 text-err/70" },
  normal: { label: "普通", cls: "border-line text-tx2" },
};

const CAT_FILTERS: { id: MailCategory | "all"; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "important", label: "重要" },
  { id: "subscription", label: "订阅" },
  { id: "spam", label: "垃圾" },
  { id: "normal", label: "普通" },
];

/** 表单样式统一：标签 16 + 间距 16 + 控件左内边距 8 */
const accRow = "flex items-center gap-4";
const accLab = "w-16 flex-none text-tx3";
const accField =
  "flex-1 border-b border-line bg-transparent py-1 pl-2 text-tx outline-none placeholder:text-tx3 focus:border-acc";

const providerPreset = (value: string) => MAIL_PROVIDER_PRESETS.find((p) => p.value === value);

const pad = (n: number) => String(n).padStart(2, "0");

function fmtWhen(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return `昨 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function splitOnce(src: string, sep: string): [string, string] {
  const i = src.indexOf(sep);
  if (i === -1) return [src, ""];
  return [src.slice(0, i), src.slice(i + sep.length)];
}

/** mail.compose <to> <subject> | <body> （mail.draft 存草稿） */
function parseCompose(raw: string, draft: boolean) {
  const rest = raw.replace(draft ? /^mail\.draft\s*/i : /^mail\.compose\s*/i, "").trim();
  if (!rest) return { error: "用法：mail.compose <收件人> <主题> | <正文>" };
  const [head, body] = splitOnce(rest, "|");
  const tokens = head.trim().split(/\s+/);
  const to = tokens[0] ?? "";
  const subject = tokens.slice(1).join(" ").trim();
  if (!to.includes("@")) return { error: "收件人需为邮箱地址，如 alice@example.com" };
  if (!subject) return { error: "缺少主题，如 mail.compose alice@example.com 周报确认 | 正文…" };
  return { to, subject, body: body.trim(), draft };
}

/** 邮件管理：多邮箱聚合收件箱（IMAP）+ AI 分类 + SMTP 写信/回复 */
export default function MailPanel() {
  const role = useAuthStore((s) => s.user?.role ?? "guest");
  // 原型 ACL：~/mail owner rw / member × / guest ×；服务端 mail:read / mail:write 兜底
  const canAccess = role === "owner";
  const canWrite = canAccess;

  const [accounts, setAccounts] = useState<MailAccountDto[]>([]);
  const [digest, setDigest] = useState<MailDigestDto | null>(null);
  const [messages, setMessages] = useState<MailMessageDto[]>([]);
  const [folder, setFolder] = useState<MailFolder>("inbox");
  const [category, setCategory] = useState<MailCategory | "all">("all");
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cmd, setCmd] = useState("");
  const [cmdError, setCmdError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [replyBody, setReplyBody] = useState("");

  // 邮箱账户注入：provider + 授权码 + IMAP/SMTP 参数
  const [accountOpen, setAccountOpen] = useState(false);
  const [accProvider, setAccProvider] = useState("qq");
  const [accName, setAccName] = useState("");
  const [accAddress, setAccAddress] = useState("");
  const [accPassword, setAccPassword] = useState("");
  const [imapHost, setImapHost] = useState(MAIL_PROVIDER_PRESETS[0].imapHost);
  const [imapPort, setImapPort] = useState(String(MAIL_PROVIDER_PRESETS[0].imapPort));
  const [imapSecure, setImapSecure] = useState(MAIL_PROVIDER_PRESETS[0].imapSecure);
  const [smtpHost, setSmtpHost] = useState(MAIL_PROVIDER_PRESETS[0].smtpHost);
  const [smtpPort, setSmtpPort] = useState(String(MAIL_PROVIDER_PRESETS[0].smtpPort));
  const [smtpSecure, setSmtpSecure] = useState(MAIL_PROVIDER_PRESETS[0].smtpSecure);
  const [accBusy, setAccBusy] = useState<"test" | "save" | null>(null);
  const [accResult, setAccResult] = useState<MailAccountTestResult | null>(null);
  const [accError, setAccError] = useState<string | null>(null);
  const [testedId, setTestedId] = useState<string | null>(null);

  // 写邮件弹窗：可视化 compose + 发件邮箱选择（每个账户各自 SMTP）
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeFrom, setComposeFrom] = useState("");
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeBusy, setComposeBusy] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [composeSuccess, setComposeSuccess] = useState<string | null>(null);
  // 正文渲染方式：有 HTML 时默认渲染 HTML，可切回纯文本
  const [bodyMode, setBodyMode] = useState<"html" | "text">("html");
  const [downloadBusy, setDownloadBusy] = useState<number | null>(null);

  useEffect(() => {
    setBodyMode("html");
  }, [selectedId]);

  // 成功后停顿 1.5s 展示结果，再自动关闭弹窗
  useEffect(() => {
    if (!composeSuccess) return;
    const timer = window.setTimeout(() => setComposeOpen(false), 1500);
    return () => window.clearTimeout(timer);
  }, [composeSuccess]);

  useEffect(() => {
    if (!composeOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setComposeOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [composeOpen]);

  const selected = useMemo(
    () => messages.find((m) => m.id === selectedId) ?? null,
    [messages, selectedId],
  );

  const reloadSummary = useCallback(async () => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    try {
      const [accs, dig] = await Promise.all([
        api<MailAccountDto[]>("/mail/accounts"),
        api<MailDigestDto>("/mail/digest"),
      ]);
      setAccounts(accs);
      setDigest(dig);
      setError(null);
      // 通知顶栏邮件入口同步未读红点
      window.dispatchEvent(new CustomEvent("aiwb:mail-changed", { detail: { unread: dig.unread } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [canAccess]);

  const loadMessages = useCallback(
    async (f: MailFolder) => {
      setListLoading(true);
      try {
        setMessages(await api<MailMessageDto[]>(`/mail/messages?folder=${f}`));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setListLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void reloadSummary();
  }, [reloadSummary]);

  useEffect(() => {
    if (!canAccess) return;
    setSelectedId(null);
    setReplyBody("");
    setCategory("all");
    setUnreadOnly(false);
    void loadMessages(folder);
  }, [folder, canAccess, loadMessages]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return messages.filter((m) => {
      if (accountFilter && m.accountId !== accountFilter) return false;
      if (category !== "all" && m.category !== category) return false;
      if (unreadOnly && m.isRead) return false;
      if (q && !`${m.fromName}\n${m.fromAddress}\n${m.subject}\n${m.body}`.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [messages, accountFilter, category, unreadOnly, query]);

  const openMessage = async (m: MailMessageDto) => {
    setSelectedId(m.id);
    setReplyBody("");
    if (!m.isRead && canWrite) {
      try {
        const next = await api<MailMessageDto>(`/mail/messages/${m.id}`, {
          method: "PATCH",
          body: JSON.stringify({ isRead: true }),
        });
        setMessages((prev) => prev.map((x) => (x.id === next.id ? next : x)));
        setDigest((d) => (d ? { ...d, unread: Math.max(0, d.unread - 1), summary: d.summary } : d));
        void reloadSummary();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  const patchMessage = async (m: MailMessageDto, patch: Record<string, unknown>, msg: string) => {
    try {
      const next = await api<MailMessageDto>(`/mail/messages/${m.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if ("folder" in patch) {
        // 移入其它文件夹后，从当前列表移除并清空阅读窗
        setMessages((prev) => prev.filter((x) => x.id !== next.id));
        if (selectedId === next.id) {
          setSelectedId(null);
          setReplyBody("");
        }
        await loadMessages(folder);
      } else {
        setMessages((prev) => prev.map((x) => (x.id === next.id ? next : x)));
      }
      setNotice(`✓ ${msg}`);
      void reloadSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const trashMessage = async (m: MailMessageDto) => {
    try {
      await api(`/mail/messages/${m.id}`, { method: "DELETE" });
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
      if (selectedId === m.id) setSelectedId(null);
      const msg =
        m.folder === "trash" ? "已从原邮箱彻底删除" : "已移入原邮箱回收站";
      setNotice(`✓ ${msg}「${m.subject}」`);
      void reloadSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const downloadAttachment = async (m: MailMessageDto, a: MailAttachmentDto) => {
    if (downloadBusy !== null) return;
    setDownloadBusy(a.index);
    try {
      const blob = await apiBlob(`/mail/messages/${m.id}/attachments/${a.index}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = a.filename;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloadBusy(null);
    }
  };

  const sendReply = async () => {
    if (!selected || !replyBody.trim() || busy) return;
    setBusy(true);
    try {
      const sent = await api<MailMessageDto>(`/mail/messages/${selected.id}/reply`, {
        method: "POST",
        body: JSON.stringify({ body: replyBody }),
      });
      setReplyBody("");
      setNotice(`✓ 回复已通过 SMTP 发送 · ${sent.subject}`);
      await loadMessages(folder);
      void reloadSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runSync = async () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const r = await api<MailSyncResult>("/mail/sync", { method: "POST" });
      const failed = r.failed > 0
        ? ` · 失败 ${r.failed} 个来源（${r.details.filter((d) => d.error).map((d) => `${d.account}: ${d.error}`).join("；")}）`
        : "";
      setNotice(`✓ 同步完成：新增 ${r.created} 封 · 跳过 ${r.skipped} 封 · ${r.accounts} 个来源${failed}`);
      if (r.failed > 0) setError("部分邮箱同步失败，请检查账户授权码与 IMAP 配置");
      setFolder("inbox");
      await Promise.all([loadMessages(folder === "inbox" ? "inbox" : folder), reloadSummary()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runClassify = async () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const r = await api<{ scanned: number; important: number; subscription: number; spam: number; normal: number }>(
        "/mail/classify",
        { method: "POST" },
      );
      setNotice(
        `✓ AI 分类完成：${r.scanned} 封 · 重要 ${r.important} · 订阅 ${r.subscription} · 垃圾 ${r.spam} · 普通 ${r.normal}`,
      );
      await Promise.all([loadMessages(folder), reloadSummary()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openCompose = (prefill?: { to?: string; subject?: string; body?: string }) => {
    setComposeFrom(accounts[0]?.id ?? "");
    setComposeTo(prefill?.to ?? "");
    setComposeSubject(prefill?.subject ?? "");
    setComposeBody(prefill?.body ?? "");
    setComposeError(null);
    setComposeSuccess(null);
    setComposeOpen(true);
  };

  const submitCompose = async (draft: boolean) => {
    if (composeBusy) return;
    const to = composeTo.trim();
    if (!to.includes("@")) {
      setComposeError("收件人需为邮箱地址，如 alice@example.com");
      return;
    }
    if (!composeSubject.trim()) {
      setComposeError("请填写主题");
      return;
    }
    setComposeBusy(true);
    setComposeError(null);
    setComposeSuccess(null);
    try {
      const m = await api<MailMessageDto>("/mail/messages", {
        method: "POST",
        body: JSON.stringify({
          accountId: composeFrom || undefined,
          to,
          subject: composeSubject.trim(),
          body: composeBody,
          draft,
        }),
      });
      setFolder(draft ? "drafts" : "sent");
      setSelectedId(m.id);
      setNotice(`✓ ${draft ? "草稿已保存" : "已通过 SMTP 发送"} · ${m.subject}`);
      setComposeSuccess(
        draft
          ? `✓ 草稿已保存 · ${m.subject}`
          : `✓ 已通过 SMTP 发送 · ${m.subject}`,
      );
      await Promise.all([loadMessages(draft ? "drafts" : "sent"), reloadSummary()]);
    } catch (e) {
      setComposeError(e instanceof Error ? e.message : String(e));
    } finally {
      setComposeBusy(false);
    }
  };

  const openAccounts = () => {
    setAccError(null);
    setAccResult(null);
    setTestedId(null);
    setAccountOpen(true);
  };

  const changeProvider = (value: string) => {
    setAccProvider(value);
    const p = providerPreset(value);
    if (!p) return;
    setImapHost(p.imapHost);
    setImapPort(String(p.imapPort));
    setImapSecure(p.imapSecure);
    setSmtpHost(p.smtpHost);
    setSmtpPort(String(p.smtpPort));
    setSmtpSecure(p.smtpSecure);
    setAccResult(null);
  };

  const accountPayload = () => ({
    name: accName.trim() || undefined,
    address: accAddress.trim(),
    provider: accProvider,
    password: accPassword.trim() || undefined,
    imapHost: imapHost.trim(),
    imapPort: Number(imapPort) || undefined,
    imapSecure,
    smtpHost: smtpHost.trim(),
    smtpPort: Number(smtpPort) || undefined,
    smtpSecure,
  });

  const testDraftAccount = async () => {
    if (accBusy) return;
    setAccError(null);
    setAccResult(null);
    if (!accAddress.trim() || !accPassword.trim()) {
      setAccError("测试连接需要填写邮箱地址与授权码");
      return;
    }
    setAccBusy("test");
    try {
      setAccResult(
        await api<MailAccountTestResult>("/mail/accounts/test", {
          method: "POST",
          body: JSON.stringify(accountPayload()),
        }),
      );
    } catch (e) {
      setAccError(e instanceof Error ? e.message : String(e));
    } finally {
      setAccBusy(null);
    }
  };

  const saveAccount = async () => {
    if (accBusy) return;
    setAccError(null);
    setAccResult(null);
    if (!accAddress.trim()) {
      setAccError("请填写邮箱地址");
      return;
    }
    if (!accPassword.trim()) {
      setAccError("请填写授权码 / 应用专用密码");
      return;
    }
    setAccBusy("save");
    try {
      const acc = await api<MailAccountDto>("/mail/accounts", {
        method: "POST",
        body: JSON.stringify(accountPayload()),
      });
      setAccAddress("");
      setAccPassword("");
      setAccName("");
      setNotice(`✓ 已注入邮箱 ${acc.address}（${acc.provider}）`);
      await reloadSummary();
    } catch (e) {
      setAccError(e instanceof Error ? e.message : String(e));
    } finally {
      setAccBusy(null);
    }
  };

  const testSavedAccount = async (acc: MailAccountDto) => {
    setAccError(null);
    setAccResult(null);
    setTestedId(acc.id);
    try {
      setAccResult(
        await api<MailAccountTestResult>(`/mail/accounts/${acc.id}/test`, { method: "POST" }),
      );
      await reloadSummary();
    } catch (e) {
      setAccError(e instanceof Error ? e.message : String(e));
    } finally {
      setTestedId(null);
    }
  };

  const deleteAccount = async (acc: MailAccountDto) => {
    if (!window.confirm(`删除邮箱 ${acc.name} <${acc.address}> 及其已同步邮件？`)) return;
    try {
      await api(`/mail/accounts/${acc.id}`, { method: "DELETE" });
      if (accountFilter === acc.id) setAccountFilter(null);
      setNotice(`✓ 已删除邮箱 ${acc.address}`);
      await Promise.all([loadMessages(folder), reloadSummary()]);
    } catch (e) {
      setAccError(e instanceof Error ? e.message : String(e));
    }
  };

  const submitCmd = async () => {
    const src = cmd.trim();
    if (!src || busy) return;
    setCmdError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (/^mail\.sync$/i.test(src)) {
        await runSync();
        setCmd("");
      } else if (/^mail\.classify$/i.test(src)) {
        await runClassify();
        setCmd("");
      } else if (/^mail\.(compose|draft)\b/i.test(src)) {
        const draft = /^mail\.draft\b/i.test(src);
        const parsed = parseCompose(src, draft);
        if (parsed.error) {
          setCmdError(parsed.error);
          return;
        }
        const m = await api<MailMessageDto>("/mail/messages", {
          method: "POST",
          body: JSON.stringify({
            to: parsed.to,
            subject: parsed.subject,
            body: parsed.body,
            draft,
          }),
        });
        setCmd("");
        setFolder(draft ? "drafts" : "sent");
        setSelectedId(m.id);
        setNotice(`✓ ${draft ? "草稿已保存" : "已通过 SMTP 发送"} · ${m.subject}`);
        await Promise.all([loadMessages(draft ? "drafts" : "sent"), reloadSummary()]);
      } else if (/^mail\.reply\b/i.test(src)) {
        if (!selected) {
          setCmdError("请先选中一封邮件再回复");
          return;
        }
        const body = src.replace(/^mail\.reply\b/i, "").replace(/^\s*\|?\s*/, "").trim();
        if (!body) {
          setCmdError("用法：mail.reply | <回复正文>");
          return;
        }
        const sent = await api<MailMessageDto>(`/mail/messages/${selected.id}/reply`, {
          method: "POST",
          body: JSON.stringify({ body }),
        });
        setCmd("");
        setNotice(`✓ 回复已通过 SMTP 发送 · ${sent.subject}`);
        await Promise.all([loadMessages(folder), reloadSummary()]);
      } else {
        setCmdError(
          "可用命令：mail.sync · mail.classify · mail.compose <收件人> <主题> | <正文> · mail.reply | <正文>（账户请在右上角「邮箱账户」注入）",
        );
      }
    } catch (e) {
      setCmdError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!canAccess) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 font-mono text-[12px] text-tx3">
        <div className="text-err">403 · ~/mail 仅 owner 可访问</div>
        <div>// 原型 ACL：owner rw · member × · guest ×</div>
        <div>// AI 助手同样受角色权限限制，无法读取该邮箱</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[12px] text-tx3">
        ⠋ 聚合 ~/mail…
      </div>
    );
  }

  const folderCount = (f: MailFolder) => {
    if (!digest) return 0;
    if (f === "inbox") return digest.inbox;
    if (f === "sent") return digest.sent;
    if (f === "drafts") return digest.drafts;
    return digest.trash;
  };

  return (
    <div className="mx-auto w-[min(1280px,97%)] py-6 font-mono">
      {/* 标题栏 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs text-tx3">
            ~/mail/{folder} — {digest?.unread ?? 0} unread
          </span>
          <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-tx3">
            {accounts.length} sources
          </span>
          {digest && digest.drafts > 0 && (
            <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-tx3">
              {digest.drafts} drafts
            </span>
          )}
        </div>
        {canWrite && (
          <div className="flex items-center gap-2 text-[11px]">
            <button
              className="rounded border border-line px-2 py-0.5 text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
              onClick={openAccounts}
            >
              邮箱账户
            </button>
            <button
              className="rounded border border-line px-2 py-0.5 text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
              onClick={() => openCompose()}
              disabled={busy || accounts.length === 0}
              title={accounts.length === 0 ? "请先在「邮箱账户」注入一个邮箱" : "可视化写信 · 选择发件邮箱"}
            >
              写邮件
            </button>
            <button
              className="rounded border border-line px-2 py-0.5 text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
              onClick={() => void runSync()}
              disabled={busy}
            >
              同步收件箱
            </button>
            <button
              className="rounded border border-line px-2 py-0.5 text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
              onClick={() => void runClassify()}
              disabled={busy}
            >
              AI 分类
            </button>
          </div>
        )}
      </div>

      {/* 写邮件弹窗：可视化 compose，发件邮箱可选 */}
      {canWrite && composeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setComposeOpen(false);
          }}
        >
          <div className="max-h-[90vh] w-[min(680px,96%)] overflow-y-auto rounded-lg border border-line bg-bg1 shadow-2xl">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[11px]">
              <span className="text-acc">▸</span>
              <span className="text-tx2">mail.compose</span>
              <span className="text-tx3">// 选择发件邮箱 · SMTP 发送</span>
              <button
                className="ml-auto rounded border border-line px-1.5 py-0.5 text-[10px] text-tx3 hover:border-err hover:text-err"
                onClick={() => setComposeOpen(false)}
                title="关闭"
              >
                ✕
              </button>
            </div>

            {accounts.length === 0 ? (
              <div className="px-4 py-10 text-center text-[11px] text-tx3">
                // 尚未注入邮箱账户
                <br />
                // 先在「邮箱账户」添加一个（需开通 IMAP / SMTP）
              </div>
            ) : (
              <>
                <div className="space-y-3 px-4 py-3 text-[11.5px]">
                  <label className={accRow}>
                    <span className={accLab}>from:</span>
                    <select
                      className={accField}
                      value={composeFrom}
                      onChange={(e) => setComposeFrom(e.target.value)}
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} &lt;{a.address}&gt;{a.status === "error" ? " · 连接异常" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={accRow}>
                    <span className={accLab}>to:</span>
                    <input
                      className={accField}
                      placeholder="alice@example.com"
                      value={composeTo}
                      onChange={(e) => {
                        setComposeTo(e.target.value);
                        setComposeError(null);
                      }}
                      autoFocus
                    />
                  </label>
                  <label className={accRow}>
                    <span className={accLab}>subject:</span>
                    <input
                      className={accField}
                      placeholder="周报确认"
                      value={composeSubject}
                      onChange={(e) => {
                        setComposeSubject(e.target.value);
                        setComposeError(null);
                      }}
                    />
                  </label>
                  <div>
                    <div className="mb-1 text-tx3">body:</div>
                    <textarea
                      className="h-56 w-full resize-y rounded border border-line bg-bg px-2 py-1.5 font-mono text-[11.5px] text-tx outline-none placeholder:text-tx3 focus:border-acc"
                      placeholder="正文…"
                      value={composeBody}
                      onChange={(e) => setComposeBody(e.target.value)}
                    />
                  </div>
                  {composeError && <div className="text-[11px] text-err">✗ {composeError}</div>}
                  {(() => {
                    const a = accounts.find((x) => x.id === composeFrom);
                    return a ? (
                      <div className="text-[10px] text-tx3">
                        // 将通过 {a.smtpHost}:{a.smtpPort} 发送
                      </div>
                    ) : null;
                  })()}
                </div>
                {composeSuccess ? (
                  <div className="flex items-center gap-2 border-t border-acc/40 bg-acc/10 px-4 py-3 text-[11.5px] text-acc">
                    <span>{composeSuccess}</span>
                    <span className="ml-auto animate-pulse text-[10px] text-tx3">即将关闭…</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-[11px]">
                    <span className="text-[10px] text-tx3">esc 关闭</span>
                    <div className="ml-auto flex gap-2">
                      <button
                        className="rounded border border-line px-2.5 py-1 text-[11px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
                        onClick={() => void submitCompose(true)}
                        disabled={composeBusy}
                      >
                        存草稿
                      </button>
                      <button
                        className="rounded border border-acc/60 bg-acc/10 px-2.5 py-1 text-[11px] text-acc hover:bg-acc/20 disabled:opacity-40"
                        onClick={() => void submitCompose(false)}
                        disabled={composeBusy}
                      >
                        {composeBusy ? "⠋ 发送中" : "⏎ 发送"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* 邮箱账户注入弹窗 */}
      {canWrite && accountOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAccountOpen(false);
          }}
        >
          <div className="max-h-[90vh] w-[min(620px,96%)] overflow-y-auto rounded-lg border border-line bg-bg1 shadow-2xl">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[11px]">
              <span className="text-acc">▸</span>
              <span className="text-tx2">mail.account</span>
              <span className="text-tx3">// IMAP 收件 / SMTP 发件</span>
              <button
                className="ml-auto rounded border border-line px-1.5 py-0.5 text-[10px] text-tx3 hover:border-err hover:text-err"
                onClick={() => setAccountOpen(false)}
                title="关闭"
              >
                ✕
              </button>
            </div>

            <div className="px-4 py-3">
              {accounts.length > 0 && (
                <div className="mb-4 space-y-1.5">
                  <div className="text-[10.5px] text-tx3">现有邮箱（{accounts.length}）· 点击「测试」验证 IMAP/SMTP</div>
                  {accounts.map((a) => (
                    <div key={a.id}>
                      <div className="flex items-center gap-2 rounded border border-line px-2 py-1.5 text-[11px]">
                        <span
                          className={
                            a.status === "ok"
                              ? "text-acc"
                              : a.status === "error"
                                ? "text-err"
                                : "text-tx3"
                          }
                        >
                          {testedId === a.id ? "⠋" : "●"}
                        </span>
                        <span className="truncate text-tx2">{a.name}</span>
                        <span className="truncate text-tx3">{a.address}</span>
                        {a.hasPassword && <span className="flex-none text-[9.5px] text-tx3">key ✓</span>}
                        <div className="ml-auto flex flex-none gap-1">
                          <button
                            className="rounded border border-line px-1.5 py-0.5 text-[10px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
                            onClick={() => void testSavedAccount(a)}
                            disabled={!a.hasPassword || testedId === a.id}
                          >
                            测试
                          </button>
                          <button
                            className="rounded border border-line px-1.5 py-0.5 text-[10px] text-tx3 hover:border-err hover:text-err"
                            onClick={() => void deleteAccount(a)}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                      {a.status === "error" && a.lastError && (
                        <div className="mt-0.5 pl-4 text-[10px] text-err">✗ {a.lastError}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="mb-2 border-t border-line pt-2 text-[10.5px] text-tx3">
                注入新邮箱（密码仅加密落库，不回传明文）
              </div>

              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveAccount();
                }}
              >
                <label className={accRow}>
                  <span className={accLab}>provider:</span>
                  <select
                    className={accField}
                    value={accProvider}
                    onChange={(e) => changeProvider(e.target.value)}
                  >
                    {MAIL_PROVIDER_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={accRow}>
                  <span className={accLab}>name:</span>
                  <input
                    className={accField}
                    placeholder="显示名称（可选，缺省取 @ 前缀）"
                    value={accName}
                    onChange={(e) => setAccName(e.target.value)}
                  />
                </label>
                <label className={accRow}>
                  <span className={accLab}>address:</span>
                  <input
                    className={accField}
                    placeholder="you@qq.com"
                    value={accAddress}
                    onChange={(e) => {
                      setAccAddress(e.target.value);
                      setAccError(null);
                    }}
                  />
                </label>
                <label className={accRow}>
                  <span className={accLab}>password:</span>
                  <input
                    className={accField}
                    type="password"
                    autoComplete="off"
                    placeholder="授权码 / 应用专用密码（QQ、163 需先在网页端开启 IMAP/SMTP）"
                    value={accPassword}
                    onChange={(e) => {
                      setAccPassword(e.target.value);
                      setAccError(null);
                    }}
                  />
                </label>
                <label className={accRow}>
                  <span className={accLab}>imap:</span>
                  <input
                    className={accField}
                    placeholder="imap.qq.com"
                    value={imapHost}
                    onChange={(e) => setImapHost(e.target.value)}
                  />
                </label>
                <div className={accRow}>
                  <span className={accLab}>imap port:</span>
                  <input
                    className="w-24 border-b border-line bg-transparent py-1 pl-2 text-tx outline-none focus:border-acc"
                    inputMode="numeric"
                    value={imapPort}
                    onChange={(e) => setImapPort(e.target.value)}
                  />
                  <label className="flex items-center gap-1.5 text-[10.5px] text-tx3">
                    <input
                      type="checkbox"
                      checked={imapSecure}
                      onChange={(e) => setImapSecure(e.target.checked)}
                    />
                    SSL/TLS
                  </label>
                </div>
                <label className={accRow}>
                  <span className={accLab}>smtp:</span>
                  <input
                    className={accField}
                    placeholder="smtp.qq.com"
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                  />
                </label>
                <div className={accRow}>
                  <span className={accLab}>smtp port:</span>
                  <input
                    className="w-24 border-b border-line bg-transparent py-1 pl-2 text-tx outline-none focus:border-acc"
                    inputMode="numeric"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(e.target.value)}
                  />
                  <label className="flex items-center gap-1.5 text-[10.5px] text-tx3">
                    <input
                      type="checkbox"
                      checked={smtpSecure}
                      onChange={(e) => setSmtpSecure(e.target.checked)}
                    />
                    SSL/TLS
                  </label>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    className="rounded border border-line px-2.5 py-1 text-[10px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
                    type="button"
                    onClick={() => void testDraftAccount()}
                    disabled={accBusy !== null}
                  >
                    {accBusy === "test" ? "⠋ 连接中" : "测试连接"}
                  </button>
                  <button
                    className="rounded border border-line px-2.5 py-1 text-[10px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
                    type="submit"
                    disabled={accBusy !== null}
                  >
                    {accBusy === "save" ? "⠋ 保存中" : "保存邮箱"}
                  </button>
                  <span className="text-[10px] text-tx3">// 先测试再保存，成功后可点「同步收件箱」</span>
                </div>
              </form>

              {accResult && (
                <div className={`mt-2 rounded border px-2 py-1.5 text-[10.5px] ${accResult.ok ? "border-acc/40 text-tx2" : "border-err/50 text-err"}`}>
                  <div>IMAP：{accResult.imap}</div>
                  <div>SMTP：{accResult.smtp}</div>
                  <div className="text-tx3">耗时 {accResult.latencyMs} ms</div>
                </div>
              )}
              {accError && <div className="mt-2 text-[11px] text-err">✗ {accError}</div>}
            </div>
          </div>
        </div>
      )}

      {/* AI 分类摘要 */}
      {digest && (
        <div className="mb-3 rounded-md border border-line bg-bg1 px-3 py-2 text-[11px] text-tx3">
          {digest.summary.split("—").map((part, i) =>
            i === 0 ? (
              <b key={i} className="font-medium text-acc">{part}</b>
            ) : (
              <span key={i}>—{part}</span>
            ),
          )}
          {digest.lastClassifiedAt && (
            <span className="ml-2 text-tx3">· {fmtWhen(digest.lastClassifiedAt)}</span>
          )}
        </div>
      )}

      {/* 账户来源 chips */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[10.5px]">
        <button
          className={`rounded border px-2 py-0.5 ${
            accountFilter === null ? "border-acc text-acc" : "border-line text-tx3 hover:border-acc"
          }`}
          onClick={() => setAccountFilter(null)}
        >
          全部来源
        </button>
        {accounts.map((a) => (
          <button
            key={a.id}
            className={`rounded border px-2 py-0.5 ${
              accountFilter === a.id ? "border-acc text-acc" : "border-line text-tx3 hover:border-acc"
            }`}
            onClick={() => setAccountFilter(accountFilter === a.id ? null : a.id)}
            title={`${a.address} · ${a.messageCount} 封 · ${a.unreadCount} 未读 · ${a.status === "ok" ? "连接正常" : a.status === "error" ? a.lastError ?? "连接失败" : "未测试"}`}
          >
            <span
              className={
                a.status === "ok" ? "mr-1 text-acc" : a.status === "error" ? "mr-1 text-err" : "mr-1"
              }
            >
              ●
            </span>
            {a.name}
            {a.unreadCount > 0 && <span className="ml-1 text-acc">{a.unreadCount}</span>}
          </button>
        ))}
      </div>

      {/* 文件夹 + 过滤 */}
      <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-line pb-2 text-[11px]">
        <div className="flex items-center gap-1">
          {FOLDERS.map((f) => (
            <button
              key={f.id}
              className={`rounded-t border border-b-0 px-2 py-1 ${
                folder === f.id
                  ? "border-line bg-bg1 text-acc"
                  : "border-transparent text-tx3 hover:text-tx2"
              }`}
              onClick={() => setFolder(f.id)}
            >
              {f.label}
              <span className="ml-1 text-[10px] text-tx3">{folderCount(f.id)}</span>
            </button>
          ))}
        </div>
        <span className="mx-1 text-tx3">|</span>
        {CAT_FILTERS.map((c) => (
          <button
            key={c.id}
            className={`rounded border px-1.5 py-0.5 ${
              category === c.id ? "border-acc text-acc" : "border-line text-tx3 hover:border-acc"
            }`}
            onClick={() => setCategory(c.id)}
          >
            {c.label}
            {c.id !== "all" && digest && (
              <span className="ml-1 text-[10px] text-tx3">{digest.categories[c.id]}</span>
            )}
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
          placeholder="grep 发件人/主题/正文…"
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

      {/* 命令栏 */}
      {canWrite && (
        <form
          className="mb-3 rounded-md border border-dashed border-line px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submitCmd();
          }}
        >
          <div className="flex items-center gap-2 text-[12px]">
            <span className="text-acc">▸</span>
            <input
              className="min-w-0 flex-1 bg-transparent text-tx outline-none placeholder:text-tx3"
              placeholder="mail.compose alice@example.com 周报确认 | 正文…   /   mail.reply | 收到，我来跟进   /   mail.sync"
              value={cmd}
              onChange={(e) => {
                setCmd(e.target.value);
                setCmdError(null);
              }}
            />
            <button
              className="rounded border border-line px-2 py-0.5 text-[10px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
              type="submit"
              disabled={busy || !cmd.trim()}
            >
              {busy ? "⠋ 执行中" : "⏎ 执行"}
            </button>
          </div>
          <div className="mt-1 text-[10px] text-tx3">
            // mail.sync · mail.classify · mail.compose &lt;收件人&gt; &lt;主题&gt; | &lt;正文&gt; · mail.reply | &lt;正文&gt;
          </div>
          {cmdError && <div className="mt-1 text-[11px] text-err">✗ {cmdError}</div>}
        </form>
      )}

      {/* 列表 + 阅读窗 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)]">
        <div className="min-w-0 overflow-hidden rounded-lg border border-line bg-bg1">
          <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[10.5px] text-tx3">
            <span>~/mail/{folder}{accountFilter ? ` @ ${accounts.find((a) => a.id === accountFilter)?.name}` : ""}</span>
            <span>
              {listLoading ? "⠋ loading" : `${visible.length} shown · ${messages.length} total`}
            </span>
          </div>
          {visible.length === 0 ? (
            <div className="px-4 py-12 text-center text-[12px] text-tx3">
              {messages.length === 0
                ? folder === "inbox"
                  ? "// 收件箱为空 —— 先在「邮箱账户」注入邮箱与授权码，再点「同步收件箱」"
                  : "// 这里还没有邮件"
                : "// 当前过滤条件没有匹配邮件"}
            </div>
          ) : (
            <div className="max-h-[560px] overflow-y-auto">
              {visible.map((m) => {
                const on = selectedId === m.id;
                const cat = CAT_META[m.category];
                return (
                  <div
                    key={m.id}
                    className={`grid cursor-pointer grid-cols-[38px_84px_minmax(0,1fr)_auto] items-baseline gap-2 border-b border-line px-2.5 py-2.5 transition-colors sm:grid-cols-[44px_120px_minmax(0,1fr)_auto] sm:gap-2.5 ${
                      on ? "bg-bg2" : "hover:bg-bg2"
                    }`}
                    onClick={() => void openMessage(m)}
                  >
                    <span className="text-[10.5px] text-tx3">{fmtWhen(m.receivedAt)}</span>
                    <span className="flex min-w-0 items-baseline gap-1 truncate text-[12.5px] text-tx">
                      {!m.isRead && <span className="text-acc">●</span>}
                      {m.isStarred && <span className="text-warn">★</span>}
                      <span className={`truncate ${m.isRead ? "text-tx2" : "text-tx"}`}>{m.fromName || m.fromAddress}</span>
                    </span>
                    <span className="min-w-0">
                      <span className={`block truncate text-[12.5px] ${on ? "text-acc" : "text-tx2"}`}>
                        {m.subject}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-tx3">AI: {m.aiReason}</span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <span className={`rounded border px-1.5 py-[1px] text-[9.5px] ${cat.cls}`}>
                        {cat.label}
                      </span>
                      <span className="text-[9.5px] text-tx3">{m.accountName}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="border-t border-line px-3 py-1.5 text-[10px] text-tx3">
            // 点击邮件自动标记已读 · AI 分类为规则式 · 收件走 IMAP / 发件走 SMTP
          </div>
        </div>

        {/* 阅读窗：桌面端为右栏；移动端选中邮件时全屏覆盖（含 ← 返回），未选中时不占位 */}
        <div
          className={`min-w-0 overflow-hidden rounded-lg border border-line bg-bg1 ${
            selected
              ? "fixed inset-0 z-30 flex flex-col rounded-none lg:static lg:z-auto lg:rounded-lg"
              : "hidden lg:block"
          }`}
        >
          <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[10.5px] text-tx3">
            <span className="flex items-center gap-2">
              {selected && (
                <button
                  className="flex items-center gap-1 rounded border border-line px-1.5 py-[1px] text-[10px] text-tx2 hover:border-acc hover:text-acc lg:hidden"
                  onClick={() => {
                    setSelectedId(null);
                    setReplyBody("");
                  }}
                >
                  ← 返回
                </button>
              )}
              <span>~/mail/{selected ? "message" : "reader"}</span>
            </span>
            {selected && (
              <button
                className="text-tx3 hover:text-err"
                onClick={() => {
                  setSelectedId(null);
                  setReplyBody("");
                }}
              >
                × 关闭
              </button>
            )}
          </div>
          {!selected ? (
            <div className="px-4 py-16 text-center text-[11px] text-tx3">
              // 选择左侧邮件查看正文
              <br />
              // 或输入 mail.compose 写一封
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-3.5 lg:max-h-[560px]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="break-words text-[14px] text-tx">{selected.subject}</div>
                  <div className="mt-1 text-[10.5px] text-tx3">
                    {selected.fromName} &lt;{selected.fromAddress}&gt;
                    <br />
                    → {selected.toAddress} · {new Date(selected.receivedAt).toLocaleString("zh-CN")}
                  </div>
                </div>
                <span className={`flex-none rounded border px-1.5 py-[1px] text-[9.5px] ${CAT_META[selected.category].cls}`}>
                  {CAT_META[selected.category].label}
                </span>
              </div>

              <div className="mt-2 rounded border border-dashed border-line px-2 py-1 text-[10.5px] text-tx3">
                AI: {selected.aiReason}
              </div>

              {selected.bodyHtml ? (
                <div className="mt-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[10px]">
                    <button
                      className={`rounded border px-1.5 py-0.5 ${
                        bodyMode === "html" ? "border-acc text-acc" : "border-line text-tx3 hover:border-acc"
                      }`}
                      onClick={() => setBodyMode("html")}
                    >
                      HTML
                    </button>
                    <button
                      className={`rounded border px-1.5 py-0.5 ${
                        bodyMode === "text" ? "border-acc text-acc" : "border-line text-tx3 hover:border-acc"
                      }`}
                      onClick={() => setBodyMode("text")}
                    >
                      纯文本
                    </button>
                    <span className="ml-1 text-[9.5px] text-tx3">
                      // 外部图片与资源已屏蔽
                    </span>
                  </div>
                  {bodyMode === "html" ? (
                    <HtmlMailBody html={selected.bodyHtml} />
                  ) : (
                    <div className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-tx2">
                      {selected.body || "（无正文）"}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-3 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-tx2">
                  {selected.body || "（无正文）"}
                </div>
              )}

              {(() => {
                const files = selected.attachments.filter((a) => !a.inline);
                if (!files.length) return null;
                return (
                  <div className="mt-3 rounded border border-line bg-bg1 p-2">
                    <div className="mb-1.5 text-[10px] text-tx3">📎 附件 · {files.length}</div>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {files.map((a) => {
                        const kind = attachmentKind(a.contentType, a.filename);
                        const isImage = a.contentType.toLowerCase().startsWith("image/");
                        return (
                          <div
                            key={a.index}
                            className="flex items-center gap-2 rounded border border-line px-2 py-1.5"
                          >
                            <div
                              className={`flex h-9 w-9 flex-none items-center justify-center rounded border text-[9px] ${kind.cls}`}
                              style={
                                isImage
                                  ? {
                                      backgroundImage:
                                        "repeating-conic-gradient(rgba(255,255,255,.12) 0% 25%, transparent 0% 50%)",
                                      backgroundSize: "10px 10px",
                                    }
                                  : undefined
                              }
                              title={a.contentType}
                            >
                              {kind.label}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[11px] text-tx2" title={a.filename}>
                                {a.filename}
                              </div>
                              <div className="text-[9.5px] text-tx3">
                                {formatBytes(a.size)}
                                {!a.available && " · 内容未落盘"}
                              </div>
                            </div>
                            {a.available && (
                              <button
                                className="flex-none rounded border border-line px-1.5 py-0.5 text-[10px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
                                onClick={() => void downloadAttachment(selected, a)}
                                disabled={downloadBusy !== null}
                                title="下载附件"
                              >
                                {downloadBusy === a.index ? "⠋" : "↓"}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {canWrite && (
                <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-line pt-2 text-[10px]">
                  <button
                    className="rounded border border-line px-1.5 py-0.5 text-tx2 hover:border-acc hover:text-acc"
                    onClick={() =>
                      void patchMessage(selected, { isStarred: !selected.isStarred }, selected.isStarred ? "已取消星标" : "已加星标")
                    }
                  >
                    {selected.isStarred ? "☆ 取消星标" : "★ 加星标"}
                  </button>
                  <button
                    className="rounded border border-line px-1.5 py-0.5 text-tx2 hover:border-acc hover:text-acc"
                    onClick={() =>
                      void patchMessage(selected, { isRead: !selected.isRead }, selected.isRead ? "已标为未读" : "已标为已读")
                    }
                  >
                    {selected.isRead ? "标为未读" : "标为已读"}
                  </button>
                  {selected.folder !== "trash" && (
                    <button
                      className="rounded border border-line px-1.5 py-0.5 text-tx2 hover:border-warn hover:text-warn"
                      onClick={() => void patchMessage(selected, { folder: "trash" }, "已移入 trash · 已同步原邮箱")}
                    >
                      → trash
                    </button>
                  )}
                  {selected.folder === "trash" && (
                    <button
                      className="rounded border border-err/50 px-1.5 py-0.5 text-err hover:bg-err/10"
                      onClick={() => void trashMessage(selected)}
                    >
                      永久删除
                    </button>
                  )}
                  {selected.folder === "drafts" && (
                    <button
                      className="rounded border border-acc/60 px-1.5 py-0.5 text-acc hover:bg-acc/10"
                      onClick={() => void patchMessage(selected, { folder: "sent" }, "草稿已通过 SMTP 发送")}
                    >
                      发送草稿
                    </button>
                  )}
                  <span className="ml-auto text-tx3">{selected.accountName}</span>
                </div>
              )}

              {canWrite && selected.direction === "inbound" && (
                <div className="mt-3">
                  <div className="mb-1 text-[10px] text-tx3">▸ 回复 {selected.fromName} &lt;{selected.fromAddress}&gt;</div>
                  <textarea
                    className="h-20 w-full resize-y rounded border border-line bg-bg px-2 py-1.5 font-mono text-[11.5px] text-tx outline-none placeholder:text-tx3 focus:border-acc"
                    placeholder={`mail.reply | 收到，我来跟进…`}
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                  />
                  <div className="mt-1 text-right">
                    <button
                      className="rounded border border-line px-2 py-0.5 text-[10px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
                      onClick={() => void sendReply()}
                      disabled={busy || !replyBody.trim()}
                    >
                      {busy ? "⠋ 发送中" : "⏎ 发送回复"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 text-[10px] text-tx3">
        // 多邮箱聚合 · AI 分类（important / subscription / spam / normal） · IMAP 收件 / SMTP 发件
      </div>
    </div>
  );
}

/** 附件类型 → 角标文字与配色（无独立图片资源，用纯文本 + 边框区分） */
function attachmentKind(contentType: string, filename: string): { label: string; cls: string } {
  const ct = contentType.toLowerCase();
  if (ct.startsWith("image/")) return { label: "IMG", cls: "border-acc/40 text-acc" };
  if (ct === "application/pdf") return { label: "PDF", cls: "border-err/50 text-err" };
  if (ct.startsWith("video/")) return { label: "VID", cls: "border-line text-tx2" };
  if (ct.startsWith("audio/")) return { label: "AUD", cls: "border-line text-tx2" };
  if (/zip|rar|7z|tar|gzip|compressed/.test(ct) || /\.(zip|rar|7z|tar|gz)$/i.test(filename)) {
    return { label: "ZIP", cls: "border-line text-tx2" };
  }
  if (/sheet|excel|csv/.test(ct)) return { label: "XLS", cls: "border-line text-tx2" };
  if (/word|document|text/.test(ct)) return { label: "DOC", cls: "border-line text-tx2" };
  return { label: "FILE", cls: "border-line text-tx3" };
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** 把邮件 HTML 装进沙箱：去脚本/外链，外部图片换占位，CSP 只允许 inline 样式与 data: 图 */
function prepareMailHtml(raw: string): string {
  const cleaned = raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<script[^>]*>/gi, "")
    .replace(/<link[^>]*>/gi, "");
  const body = cleaned.replace(/<img\b[^>]*>/gi, (tag) =>
    /src\s*=\s*["']data:/i.test(tag)
      ? tag
      : '<div class="__ph">🖼 图片占位 · 外部图片已屏蔽</div>',
  );
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">
<style>
html,body{margin:0;padding:12px;font:13px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;color:#1f2328;background:#fff;word-break:break-word}
img{max-width:100%;height:auto}table{max-width:100%;border-collapse:collapse}
.__ph{display:flex;align-items:center;justify-content:center;min-height:72px;margin:8px 0;border:1px dashed #c9ced6;border-radius:6px;color:#8b949e;font-size:12px;background:repeating-linear-gradient(45deg,#f6f8fa,#f6f8fa 8px,#eef1f4 8px,#eef1f4 16px)}
</style></head><body>${body}</body></html>`;
}

function HtmlMailBody({ html }: { html: string }) {
  const srcDoc = useMemo(() => prepareMailHtml(html), [html]);
  return (
    <iframe
      title="邮件 HTML 正文"
      sandbox=""
      srcDoc={srcDoc}
      className="h-[420px] w-full rounded border border-line bg-white"
    />
  );
}
