import { useEffect, useMemo, useState } from "react";
import type {
  ContactChannel,
  ContactChannelType,
  ContactProfile,
  ContactVisibility,
  OwnContactDto,
  PublicContactDto,
} from "@aiwb/shared";
import { api } from "../../lib/api";
import { useAuthStore } from "../../stores/auth";
import PublicBackLink from "../public/PublicBackLink";

const CHANNEL_META: Record<ContactChannelType, { label: string; icon: string }> = {
  email: { label: "邮箱", icon: "✉" },
  github: { label: "GitHub", icon: "◈" },
  website: { label: "主页", icon: "⌂" },
  booking: { label: "预约", icon: "◷" },
  wechat: { label: "微信", icon: "◍" },
  phone: { label: "电话", icon: "☎" },
};

const CHANNEL_ORDER: ContactChannelType[] = ["email", "github", "website", "booking", "wechat", "phone"];

const EMPTY_CONTACT: ContactProfile = {
  preferred: "email",
  responseTime: "1 个工作日内",
  availability: "",
  channels: [],
  updatedAt: null,
};

function labelOf(type: ContactChannelType): string {
  return CHANNEL_META[type]?.label ?? type;
}

function copyText(text: string, done: () => void) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(done);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    done();
  } catch {
    // 忽略：复制失败不阻塞页面
  }
  ta.remove();
}

/** 游客公开只读页 /c/:username；所有者登录后可在此页直接编辑 */
export default function PublicContactPage({ username }: { username: string }) {
  const user = useAuthStore((s) => s.user);
  // 「是不是站长本人」与「能不能改」分开：
  // 普通用户访问 /c/admin 看到的是 admin 的联系信息，但只有 owner 本人能编辑
  const isOwner = user?.username === username && user?.role === "owner";

  const [data, setData] = useState<PublicContactDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<ContactProfile>(EMPTY_CONTACT);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);

    const load = async () => {
      if (isOwner) {
        try {
          const own = await api<OwnContactDto>("/profile/contact");
          if (alive) setData({ username: own.username, contact: own.contact });
          return;
        } catch {
          // 令牌失效时退回公开读取，页面仍然可用
        }
      }
      const res = await fetch(`/api/profile/public/${encodeURIComponent(username)}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      const pub = (await res.json()) as PublicContactDto;
      if (alive) setData(pub);
    };

    load().catch((e) => {
      if (alive) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      alive = false;
    };
  }, [username, isOwner]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 1800);
    return () => clearTimeout(t);
  }, [notice]);

  const contact = data?.contact ?? EMPTY_CONTACT;
  const publicChannels = useMemo(
    () => (isOwner ? contact.channels : contact.channels.filter((c) => c.visibility === "public")),
    [contact.channels, isOwner],
  );

  const beginEdit = () => {
    setDraft({
      ...contact,
      channels: CHANNEL_ORDER.map((type) => {
        const found = contact.channels.find((c) => c.type === type);
        return found ?? {
          type,
          label: labelOf(type),
          value: "",
          visibility: type === "wechat" || type === "phone" ? "owner" : "public",
        };
      }).filter((c) => c.value) as ContactChannel[],
    });
    setEditing(true);
  };

  const setChannel = (type: ContactChannelType, patch: Partial<ContactChannel>) => {
    setDraft((prev) => {
      const exists = prev.channels.find((c) => c.type === type);
      const channels = exists
        ? prev.channels.map((c) => (c.type === type ? { ...c, ...patch } : c))
        : [
            ...prev.channels,
            {
              type,
              label: labelOf(type),
              value: "",
              visibility: (type === "wechat" || type === "phone" ? "owner" : "public") as ContactVisibility,
              ...patch,
            },
          ];
      return { ...prev, channels };
    });
  };

  const save = async () => {
    const channels = draft.channels
      .map((c) => ({ ...c, label: c.label || labelOf(c.type), value: c.value.trim() }))
      .filter((c) => c.value);
    if (channels.length === 0) {
      setNotice("至少填写一个联系方式");
      return;
    }
    setSaving(true);
    try {
      const own = await api<OwnContactDto>("/profile/contact", {
        method: "PUT",
        body: JSON.stringify({ contact: { ...draft, channels } }),
      });
      setData({ username: own.username, contact: own.contact });
      setEditing(false);
      setNotice("已保存");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const rows = editing ? draft.channels : publicChannels;
  const preferredLabel = labelOf(editing ? draft.preferred : contact.preferred);

  return (
    <div className="grid-bg flex min-h-full flex-col items-center px-4 py-8 font-mono">
      <div className="mb-4 flex w-[min(880px,100%)] items-center justify-between gap-3 text-[11px] text-tx3">
        <span className="min-w-0 truncate">
          <span className="text-acc">◈</span> AI-WORKBENCH · public contact
        </span>
        <span className="flex flex-none items-center gap-3">
          <span className="hidden rounded border border-acc/40 px-1.5 py-0.5 text-[9px] tracking-widest text-acc sm:inline">
            PUBLIC · READ ONLY
          </span>
          <PublicBackLink />
        </span>
      </div>

      <div className="w-[min(820px,100%)]">
        {data ? (
          <div className="overflow-hidden rounded-lg border border-line bg-bg1 shadow-2xl">
            <div className="flex h-[31px] items-center gap-2 border-b border-line bg-bg2 px-3 text-[10px] text-tx3">
              <span className="flex gap-1.5">
                <i className="block h-[7px] w-[7px] rounded-full bg-err/60" />
                <i className="block h-[7px] w-[7px] rounded-full bg-warn/60" />
                <i className="block h-[7px] w-[7px] rounded-full bg-acc/60" />
              </span>
              <span className="min-w-0 flex-1 truncate">~/contact.txt</span>
              <span className="rounded border border-line px-1.5 py-0.5 text-[9px] tracking-wider">UTF-8</span>
            </div>

            <div className="p-6 sm:p-7">
              <div className="flex flex-wrap items-start gap-4 border-b border-line pb-5">
                <div className="flex h-[50px] w-[50px] flex-none items-center justify-center rounded border border-acc/40 bg-acc/10 font-mono text-[18px] text-acc">
                  {username.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="text-[22px] font-semibold leading-tight text-tx">{data.username}</h1>
                  <div className="mt-1 text-[12px] text-tx2">{contact.availability || "公开联系方式"}</div>
                  <div className="mt-2 flex items-center gap-1.5 text-[10px] text-tx2">
                    <i className="block h-1 w-1 rounded-full bg-acc" />
                    开放技术交流 / 合作
                  </div>
                </div>
                {isOwner && !editing && (
                  <button
                    type="button"
                    onClick={beginEdit}
                    className="h-[27px] flex-none rounded border border-line px-2.5 text-[10px] text-tx2 transition-colors hover:border-acc hover:text-acc"
                  >
                    编辑联系方式
                  </button>
                )}
              </div>

              {!editing ? (
                <>
                  <div className="my-4 flex flex-wrap items-center gap-2 rounded border border-acc/20 bg-acc/[0.04] px-3 py-2.5 text-[11px] text-tx2">
                    <span className="text-[9px] uppercase tracking-wider text-tx3">首选联系</span>
                    <span>
                      <b className="font-medium text-acc">{preferredLabel}</b> · 通常{" "}
                      <b className="font-medium text-acc">{contact.responseTime}</b> 回复
                    </span>
                    {contact.availability && (
                      <span className="text-tx3">可用时间：{contact.availability}</span>
                    )}
                  </div>

                  <div>
                    {publicChannels.length === 0 ? (
                      <div className="py-6 text-center text-[11px] text-tx3">
                        // 所有者尚未填写联系方式
                      </div>
                    ) : (
                      publicChannels.map((c) => (
                        <ChannelRow key={c.type} channel={c} onCopied={() => setNotice("已复制")} />
                      ))
                    )}
                  </div>
                </>
              ) : (
                <EditForm
                  draft={draft}
                  saving={saving}
                  onChange={setChannel}
                  onPatch={setDraft}
                  onSave={save}
                  onCancel={() => setEditing(false)}
                />
              )}

              <div className="mt-5 border-t border-line pt-3 text-[9.5px] leading-relaxed text-tx3">
                公开渠道由所有者维护；标注「仅自己」的渠道不会出现在访客请求中。
                <br />
                // public read-only · /c/{username}
              </div>
            </div>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-line bg-bg1 px-5 py-6 text-[12px]">
            <div className="text-err">✗ 404 · {error}</div>
            <div className="mt-2 text-tx3">该公开联系页不存在或用户名有误</div>
          </div>
        ) : (
          <div className="flex h-[220px] items-center justify-center rounded-lg border border-line bg-bg1 text-[12px] text-tx3">
            ⠋ 读取联系方式…
          </div>
        )}
      </div>

      {notice && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded border border-acc/50 bg-bg2 px-3 py-1.5 text-[10px] text-acc shadow-lg">
          {notice}
        </div>
      )}
    </div>
  );
}

function ChannelRow({ channel, onCopied }: { channel: ContactChannel; onCopied: () => void }) {
  const meta = CHANNEL_META[channel.type];
  const canCopy = channel.type === "email" || channel.type === "wechat" || channel.type === "phone";
  const href = channel.url;
  return (
    <div className="grid grid-cols-[24px_84px_minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-dashed border-line py-2.5 last:border-b-0 max-sm:grid-cols-[22px_minmax(0,1fr)_auto]">
      <span className="text-center text-[13px] text-tx3">{meta?.icon ?? "·"}</span>
      <span className="text-[10px] uppercase tracking-wider text-tx3 max-sm:col-start-2">{meta?.label ?? channel.label}</span>
      {href ? (
        <a
          href={href}
          target={channel.type === "email" ? undefined : "_blank"}
          rel={channel.type === "email" ? undefined : "noopener noreferrer"}
          className="min-w-0 truncate text-[11.5px] text-tx hover:text-acc max-sm:col-start-2"
        >
          {channel.value}
        </a>
      ) : (
        <span className="min-w-0 truncate text-[11.5px] text-tx max-sm:col-start-2">{channel.value}</span>
      )}
      <span
        className={`rounded border px-1.5 py-0.5 text-[9px] ${
          channel.visibility === "public"
            ? "border-acc/40 bg-acc/[0.04] text-acc"
            : "border-line text-tx3"
        }`}
      >
        {channel.visibility === "public" ? "公开" : "仅自己"}
      </span>
      {canCopy ? (
        <button
          type="button"
          onClick={() => copyText(channel.value, onCopied)}
          className="rounded border border-line px-1.5 py-0.5 text-[9.5px] text-tx2 transition-colors hover:border-acc hover:text-acc"
        >
          复制
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

function EditForm({
  draft,
  saving,
  onChange,
  onPatch,
  onSave,
  onCancel,
}: {
  draft: ContactProfile;
  saving: boolean;
  onChange: (type: ContactChannelType, patch: Partial<ContactChannel>) => void;
  onPatch: (fn: (prev: ContactProfile) => ContactProfile) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const valueOf = (type: ContactChannelType) => draft.channels.find((c) => c.type === type)?.value ?? "";
  const visibilityOf = (type: ContactChannelType): ContactVisibility =>
    draft.channels.find((c) => c.type === type)?.visibility ?? (type === "wechat" || type === "phone" ? "owner" : "public");

  return (
    <div className="mt-4 rounded border border-line bg-bg2 p-4">
      <div className="mb-3 flex items-center justify-between gap-2 text-[10px] text-tx2">
        <span>编辑联系方式</span>
        <span className="text-[9px] text-tx3">仅所有者可见</span>
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-[9.5px] uppercase tracking-wider text-tx3">
          首选联系
          <select
            value={draft.preferred}
            onChange={(e) => onPatch((p) => ({ ...p, preferred: e.target.value as ContactChannelType }))}
            className="h-[30px] rounded border border-line bg-bg1 px-2 font-mono text-[11px] normal-case tracking-normal text-tx focus:border-acc"
          >
            {CHANNEL_ORDER.map((t) => (
              <option key={t} value={t}>{labelOf(t)}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[9.5px] uppercase tracking-wider text-tx3">
          响应时间
          <input
            value={draft.responseTime}
            onChange={(e) => onPatch((p) => ({ ...p, responseTime: e.target.value }))}
            className="h-[30px] rounded border border-line bg-bg1 px-2 font-mono text-[11px] normal-case tracking-normal text-tx focus:border-acc"
          />
        </label>
        <label className="grid gap-1 text-[9.5px] uppercase tracking-wider text-tx3 sm:col-span-2">
          可用时间 / 状态
          <input
            value={draft.availability}
            onChange={(e) => onPatch((p) => ({ ...p, availability: e.target.value }))}
            placeholder="工作日 10:00–18:00 (UTC+8)"
            className="h-[30px] rounded border border-line bg-bg1 px-2 font-mono text-[11px] normal-case tracking-normal text-tx placeholder:text-tx3 focus:border-acc"
          />
        </label>
      </div>

      <div className="space-y-2">
        {CHANNEL_ORDER.map((type) => (
          <div key={type} className="grid items-center gap-2 sm:grid-cols-[70px_minmax(0,1fr)_104px]">
            <span className="text-[9.5px] uppercase tracking-wider text-tx3">{labelOf(type)}</span>
            <input
              value={valueOf(type)}
              onChange={(e) => onChange(type, { value: e.target.value })}
              placeholder={type === "email" ? "you@example.com" : type === "github" ? "github.com/you" : ""}
              className="h-[30px] min-w-0 rounded border border-line bg-bg1 px-2 font-mono text-[11px] text-tx placeholder:text-tx3 focus:border-acc"
            />
            <select
              value={visibilityOf(type)}
              onChange={(e) => onChange(type, { visibility: e.target.value as ContactVisibility })}
              className="h-[30px] rounded border border-line bg-bg1 px-2 font-mono text-[11px] text-tx focus:border-acc"
            >
              <option value="public">公开</option>
              <option value="owner">仅自己</option>
            </select>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="h-[28px] rounded border border-acc/50 bg-acc/10 px-3 text-[10px] text-acc transition-colors hover:bg-acc/20 disabled:opacity-50"
        >
          {saving ? "保存中…" : "保存"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-[28px] rounded border border-line px-2.5 text-[10px] text-tx2 hover:border-line hover:text-tx"
        >
          取消
        </button>
        <span className="ml-auto text-[9px] text-tx3">PUT /api/profile/contact</span>
      </div>
    </div>
  );
}
