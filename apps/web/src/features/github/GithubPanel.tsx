import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { useAuthStore } from "../../stores/auth";
import { MarkdownText } from "../../lib/markdown";

// ── 类型 ────────────────────────────────────────────────

interface GithubAccount {
  id: string;
  username: string | null;
  status: "ok" | "error" | "untested";
  lastError: string | null;
  updatedAt: string;
  tokenMasked: string | null;
}

interface GhProfile {
  login: string;
  name: string | null;
  avatarUrl: string;
  bio: string | null;
  publicRepos: number;
  followers: number;
  following: number;
  htmlUrl: string;
  fetchedAt: string;
  stale: boolean;
}

interface GhRepo {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  private: boolean;
  archived: boolean;
  defaultBranch: string;
  pushedAt: string;
  htmlUrl: string;
}

interface ReposResp {
  items: GhRepo[];
  fetchedAt: string;
  stale: boolean;
}

interface CalendarDay {
  date: string;
  count: number;
  level: "NONE" | "FIRST_QUARTILE" | "SECOND_QUARTILE" | "THIRD_QUARTILE" | "FOURTH_QUARTILE";
}
interface CalendarData {
  total: number;
  weeks: CalendarDay[][];
  fetchedAt: string;
  stale: boolean;
}

interface LangItem {
  lang: string;
  bytes: number;
  pct: number;
}
interface LanguagesData {
  total: number;
  list: LangItem[];
  fetchedAt: string;
  stale: boolean;
}

interface RepoMeta {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  defaultBranch: string;
  private: boolean;
  archived: boolean;
  topics: string[];
  license: string | null;
  createdAt: string;
  pushedAt: string;
  updatedAt: string;
  htmlUrl: string;
}
interface ReadmeData {
  content: string;
  path: string;
  htmlUrl: string | null;
}
interface CiRun {
  repo: string;
  conclusion: string | null;
  status: string;
  name: string;
  htmlUrl: string;
  updatedAt: string;
}
interface RepoDetailResp {
  repo: RepoMeta;
  readme: ReadmeData;
  ci: CiRun | null;
  fetchedAt: string;
  stale: boolean;
}

interface InboxItem {
  title: string;
  htmlUrl: string;
  repo: string;
  number?: number;
  kind: string;
  author?: string | null;
  reason?: string | null;
  updatedAt: string;
}
interface InboxData {
  reviewRequested: InboxItem[];
  assigned: InboxItem[];
  notifications: InboxItem[];
  ciFailing: { repo: string; htmlUrl: string }[];
  fetchedAt: string;
  stale: boolean;
}

type DigestEventType =
  | "release" | "security" | "star" | "ci" | "review"
  | "issue" | "archived" | "commit" | "other";

interface DigestItem {
  text: string;
  url: string | null;
  repo: string | null;
  eventType: DigestEventType;
  eventAt: string | null;
}

interface DigestData {
  items: DigestItem[];
  source: "llm" | "rule";
  excludedTrending: string[];
  fetchedAt: string;
  stale: boolean;
}

const DIGEST_BADGE: Record<DigestEventType, { label: string; cls: string }> = {
  security: { label: "SECURITY", cls: "border-err text-err" },
  ci: { label: "CI", cls: "border-warn text-warn" },
  release: { label: "RELEASE", cls: "border-acc/60 text-acc" },
  review: { label: "REVIEW", cls: "border-acc/40 text-acc" },
  issue: { label: "ISSUE", cls: "border-line text-tx2" },
  star: { label: "STAR", cls: "border-dashed border-line text-acc" },
  archived: { label: "ARCHIVED", cls: "border-line text-tx2" },
  commit: { label: "COMMIT", cls: "border-line text-tx2" },
  other: { label: "UPDATE", cls: "border-line text-tx2" },
};

interface TrendingData {
  since: string;
  items: { fullName: string; description: string | null; stars: number; language: string | null; url: string }[];
  fetchedAt: string;
  stale: boolean;
}

interface CommitItem {
  sha: string;
  shortSha: string;
  message: string;
  author: string | null;
  login: string | null;
  date: string;
  htmlUrl: string;
}
interface CommitsResp {
  items: CommitItem[];
  fetchedAt: string;
  stale: boolean;
}

interface TreeNode {
  path: string;
  type: "blob" | "tree";
  size: number;
}
interface TreeResp {
  truncated: boolean;
  tree: TreeNode[];
  fetchedAt: string;
  stale: boolean;
}

// ── 工具函数 ────────────────────────────────────────────

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function relTime(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

type TabId = "overview" | "repos" | "activity" | "inbox";

// ── 面板 ────────────────────────────────────────────────

export default function GithubPanel() {
  // 观察窗数据归站点主人；普通用户只读，不能绑定/更换 Token
  const canManage = useAuthStore((s) => s.user?.role === "owner");
  const [account, setAccount] = useState<GithubAccount | null | undefined>(undefined);
  const [profile, setProfile] = useState<GhProfile | null>(null);
  const [repos, setRepos] = useState<GhRepo[]>([]);
  const [reposFetchedAt, setReposFetchedAt] = useState<string>("");
  const [reposStale, setReposStale] = useState(false);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<TabId>("overview");
  const [selected, setSelected] = useState<{ owner: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<GithubAccount | null>("/github/account")
      .then(setAccount)
      .catch(() => setAccount(null));
  }, []);

  useEffect(() => {
    if (!account) return;
    setLoading(true);
    Promise.all([
      api<GhProfile>("/github/profile"),
      api<ReposResp>(`/github/repos${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    ])
      .then(([p, r]) => {
        setProfile(p);
        setRepos(r.items);
        setReposFetchedAt(r.fetchedAt);
        setReposStale(r.stale);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [account, q]);

  if (account === undefined) {
    return (
      <div className="mx-auto w-[min(900px,94%)] py-8 font-mono">
        <div className="text-xs text-tx3">~/gh · 加载中…</div>
      </div>
    );
  }

  if (account === null || account.status !== "ok") {
    if (!canManage) {
      return (
        <div className="mx-auto w-[min(900px,94%)] py-8 font-mono text-[12px]">
          <div className="text-err">✗ GitHub 观察窗尚未配置</div>
          <div className="mt-1 text-tx3">// Token 由站点主人绑定，普通账号只读查看</div>
        </div>
      );
    }
    return (
      <PatSetup
        account={account ?? undefined}
        onSaved={() => api<GithubAccount>("/github/account").then(setAccount)}
        onRemoved={() => setAccount(null)}
      />
    );
  }

  const refresh = () => {
    setLoading(true);
    Promise.all([
      api<GhProfile>("/github/profile?refresh=1"),
      api<ReposResp>(`/github/repos?refresh=1${q ? `&q=${encodeURIComponent(q)}` : ""}`),
    ])
      .then(([p, r]) => {
        setProfile(p);
        setRepos(r.items);
        setReposFetchedAt(r.fetchedAt);
        setReposStale(r.stale);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  return (
    <div className="mx-auto w-[min(1040px,96%)] py-6 font-mono text-tx">
      {/* 顶栏 */}
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line pb-3 text-[12px]">
        <span className="text-tx3">~/gh</span>
        {profile && (
          <a href={profile.htmlUrl} target="_blank" rel="noopener noreferrer" className="text-acc hover:underline">
            @{profile.login}
          </a>
        )}
        <span className="text-tx3">{repos.length} repos</span>
        <span className={`flex items-center gap-1.5 ${reposStale ? "text-warn" : "text-tx3"}`}>
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
          {reposStale ? "stale · " : ""}同步于 {reposFetchedAt ? fmtTime(reposFetchedAt) : "--:--"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={refresh}
            className="rounded border border-line px-2 py-1 text-[11px] text-tx3 hover:border-acc hover:text-acc"
          >
            {loading ? "…" : "↻ 刷新"}
          </button>
          {profile && (
            <a
              href={profile.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-line px-2 py-1 text-[11px] text-tx3 hover:border-acc hover:text-acc"
            >
              ↗ github.com
            </a>
          )}
        </div>
      </div>

      {/* Tab 条：收件箱是站点主人的个人通知，普通用户不可见 */}
      <div className="mb-4 flex gap-1 border-b border-line">
        {([
          ["overview", "概览"],
          ["repos", "仓库"],
          ["activity", "活跃"],
          ["inbox", "收件"],
        ] as [TabId, string][])
          .filter(([id]) => canManage || id !== "inbox")
          .map(([id, label]) => (
          <button
            key={id}
            onClick={() => {
              setTab(id);
              setSelected(null);
            }}
            className={`-mb-px border-b-2 px-3 py-1.5 text-[12px] transition-colors ${
              tab === id ? "border-acc text-acc" : "border-transparent text-tx3 hover:text-tx"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <OverviewTab profile={profile} canManage={canManage} onGoInbox={() => setTab("inbox")} />
      )}
      {tab === "repos" &&
        (selected ? (
          <RepoDetail
            owner={selected.owner}
            name={selected.name}
            onBack={() => setSelected(null)}
          />
        ) : (
          <ReposGrid repos={repos} q={q} setQ={setQ} onOpen={(r) => setSelected({ owner: r.owner, name: r.name })} />
        ))}
      {tab === "activity" && <ActivityTab />}
      {tab === "inbox" && canManage && <InboxTab />}

      <div className="mt-6 text-[10px] text-tx3">
        // 数据来自 GitHub 快照，热数据 15–30 分钟、日历/语言 24 小时；限流时显示 stale 旧数据。只读观察窗，所有操作 ↗ 回 GitHub。
      </div>
    </div>
  );
}

// ── Tab 1 · 概览（贡献热力图 + AI 简报 + 数字格） ────────

function OverviewTab({
  profile,
  canManage,
  onGoInbox,
}: {
  profile: GhProfile | null;
  canManage: boolean;
  onGoInbox: () => void;
}) {
  const [cal, setCal] = useState<CalendarData | null>(null);
  const [digest, setDigest] = useState<DigestData | null>(null);
  const [digestBusy, setDigestBusy] = useState(false);
  const [inbox, setInbox] = useState<InboxData | null>(null);
  const [trending, setTrending] = useState<TrendingData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  /** force = 跳过服务端快照（空简报只缓存 5 分钟），用户手动刷新时用 */
  const loadDigest = (force = false) => {
    if (force) setDigestBusy(true);
    api<DigestData>(`/github/inbox/digest${force ? "?refresh=1" : ""}`)
      .then(setDigest)
      .catch(() => {})
      .finally(() => setDigestBusy(false));
  };

  useEffect(() => {
    api<CalendarData>("/github/activity/calendar")
      .then(setCal)
      .catch((e) => setErr(e instanceof Error ? e.message : "加载失败"));
    api<TrendingData>("/github/trending").then(setTrending).catch(() => {});
    // 收件箱与 AI 简报属于站点主人的个人数据，普通用户不请求
    if (canManage) {
      loadDigest();
      api<InboxData>("/github/inbox").then(setInbox).catch(() => {});
    }
  }, [canManage]);

  return (
    <div className="space-y-5">
      {profile && (
        <div className="flex items-center gap-4 rounded-lg border border-line bg-bg1 p-4">
          <img src={profile.avatarUrl} alt="" className="h-14 w-14 rounded border border-line" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold text-tx">{profile.name ?? profile.login}</span>
              <a href={profile.htmlUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-acc hover:underline">
                @{profile.login} ↗
              </a>
            </div>
            {profile.bio && <div className="mt-1 text-[12px] text-tx3">{profile.bio}</div>}
            <div className="mt-1.5 flex gap-4 text-[11px] text-tx3">
              <span>{profile.publicRepos} repos</span>
              <span>{profile.followers} followers</span>
              <span>{profile.following} following</span>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        {/* 左：贡献热力图 */}
        <div className="rounded-lg border border-line bg-bg1 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[12px] font-semibold text-tx">贡献热力图</h3>
            {cal && <span className="text-[11px] text-tx3">{cal.total.toLocaleString()} contributions in the last year</span>}
          </div>
          {err ? (
            <div className="py-10 text-center text-[11px] text-err">{err}</div>
          ) : !cal ? (
            <div className="py-10 text-center text-[11px] text-tx3">加载中…</div>
          ) : (
            <Heatmap weeks={cal.weeks} />
          )}
        </div>

        {/* 右列：数字格 + 热门新项目 */}
        <div className="space-y-4">
          {canManage && (
            <div className="grid grid-cols-3 gap-2">
              <StatCell label="待 review" value={inbox?.reviewRequested.length} onClick={onGoInbox} />
              <StatCell label="指派给我" value={inbox?.assigned.length} onClick={onGoInbox} />
              <StatCell label="需关注" value={inbox?.ciFailing.length} warn onClick={onGoInbox} />
            </div>
          )}

          {/* 热门新项目榜：官方搜索代理，非 github.com/trending */}
          {trending && trending.items.length > 0 && (
            <div className="rounded-lg border border-line bg-bg1 p-4">
              <h3 className="mb-1 text-[12px] font-semibold text-tx">本周热门新项目</h3>
              <div className="mb-3 text-[9px] text-tx3">近 7 天创建 · 按 stars · 官方搜索代理，非 trending 页</div>
              <ul className="space-y-2.5">
                {trending.items.map((r) => (
                  <li key={r.fullName}>
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="group block">
                      <div className="flex items-center gap-2 text-[11.5px]">
                        <span className="min-w-0 flex-1 truncate font-medium text-acc group-hover:underline">{r.fullName}</span>
                        <span className="flex-none text-[10px] text-tx3">★ {fmtNum(r.stars)}</span>
                      </div>
                      {r.description && (
                        <div className="mt-0.5 truncate text-[10px] text-tx3">{r.description}</div>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center gap-1.5 border-t border-line pt-2.5 text-[9px] text-tx3">
                <span className="h-1 w-1 rounded-full bg-acc" />
                已与 AI 简报按 owner/repo 互斥
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 全宽 AI 简报：4–5 条事件型，不与热门榜重合；仅站点主人可见 */}
      {canManage && <DigestCard digest={digest} busy={digestBusy} onRefresh={() => loadDigest(true)} />}
    </div>
  );
}

function DigestCard({
  digest,
  busy,
  onRefresh,
}: {
  digest: DigestData | null;
  busy: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="rounded-lg border border-line bg-bg1 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[12px] font-semibold text-tx">AI 今日简报</h3>
          {digest && digest.items.length > 0 && (
            <span className="text-[10px] text-acc">{digest.items.length}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[9px] text-tx3">
          {digest && (
            <>
              <span>{digest.source === "llm" ? "LLM" : "规则兜底"}</span>
              <span>生成于 {fmtTime(digest.fetchedAt)}</span>
              {digest.stale && <span className="text-warn">stale</span>}
              {digest.excludedTrending.length > 0 && (
                <span>已排除 {digest.excludedTrending.length} 个热门榜仓库</span>
              )}
            </>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy}
            className="rounded border border-line px-1.5 py-0.5 text-[9px] text-tx3 hover:border-acc hover:text-acc disabled:opacity-50"
            title="重新生成简报（跳过快照缓存）"
          >
            {busy ? "生成中…" : "↻ 刷新"}
          </button>
        </div>
      </div>
      {!digest ? (
        <div className="py-6 text-center text-[11px] text-tx3">生成中…</div>
      ) : digest.items.length === 0 ? (
        <div className="py-6 text-center text-[11px] text-tx3">
          // 今天没有通知、CI 失败或近 30 天的提交动态
          <div className="mt-1 text-[10px] text-tx3">可点右上角刷新重试；空结果只缓存 5 分钟</div>
        </div>
      ) : (
        <ul>
          {digest.items.map((it, i) => {
            const badge = DIGEST_BADGE[it.eventType] ?? DIGEST_BADGE.other;
            const body = (
              <>
                <span className={`inline-flex h-[18px] items-center rounded border px-1.5 font-mono text-[9px] tracking-wider ${badge.cls}`}>
                  {badge.label}
                </span>
                <span className="min-w-0">
                  {it.repo && <span className="block truncate font-mono text-[10.5px] text-tx2">{it.repo}</span>}
                  <span className="block text-[12px] leading-relaxed text-tx">{it.text}</span>
                </span>
                <span className="flex flex-none items-center gap-2 font-mono text-[9.5px] text-tx3">
                  {it.eventAt && <span>{fmtTime(it.eventAt)}</span>}
                  {it.url && <span className="text-acc">↗</span>}
                </span>
              </>
            );
            const rowClass = "grid grid-cols-[76px_minmax(0,1fr)_auto] items-start gap-3 rounded px-1 py-2.5";
            return (
              <li key={`${it.repo ?? "unknown"}-${i}`} className="border-b border-dashed border-line last:border-b-0">
                {it.url ? (
                  <a
                    href={it.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${rowClass} transition-colors hover:bg-bg2`}
                  >
                    {body}
                  </a>
                ) : (
                  <div className={rowClass}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatCell({ label, value, warn, onClick }: { label: string; value?: number; warn?: boolean; onClick: () => void }) {
  const hot = (value ?? 0) > 0;
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-line bg-bg1 p-3 text-center transition-colors hover:border-acc"
    >
      <div className={`text-[20px] font-bold ${warn && hot ? "text-warn" : hot ? "text-acc" : "text-tx3"}`}>
        {value === undefined ? "–" : value}
      </div>
      <div className="mt-0.5 text-[10px] text-tx3">{label}</div>
    </button>
  );
}

// ── Tab 4 · 收件 ────────────────────────────────────────

function InboxTab() {
  const [inbox, setInbox] = useState<InboxData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<InboxData>("/github/inbox")
      .then(setInbox)
      .catch((e) => setErr(e instanceof Error ? e.message : "加载失败"));
  }, []);

  if (err) return <div className="rounded border border-err/50 bg-err/5 px-3 py-2 text-[11px] text-err">{err}</div>;
  if (!inbox) return <div className="py-16 text-center text-[11px] text-tx3">加载中…</div>;

  const empty = inbox.reviewRequested.length + inbox.assigned.length + inbox.notifications.length === 0;
  return (
    <div className="space-y-5">
      {inbox.ciFailing.length > 0 && (
        <div className="rounded-lg border border-warn/40 bg-warn/5 p-3 text-[11px] text-warn">
          需关注：{inbox.ciFailing.map((c) => c.repo).join("、")} 最近一次 CI 失败
        </div>
      )}
      {empty && (
        <div className="rounded-lg border border-dashed border-line py-16 text-center text-xs text-tx3">
          // 收件箱是空的
        </div>
      )}
      <InboxGroup title="待我 review" items={inbox.reviewRequested} />
      <InboxGroup title="指派给我" items={inbox.assigned} />
      <InboxGroup title="未读通知" items={inbox.notifications} />
    </div>
  );
}

function InboxGroup({ title, items }: { title: string; items: InboxItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-line bg-bg1">
      <div className="border-b border-line px-4 py-2 text-[12px] font-semibold text-tx">
        {title} <span className="text-acc">({items.length})</span>
      </div>
      <ul>
        {items.map((it, i) => (
          <li key={`${it.htmlUrl}-${i}`}>
            <a
              href={it.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 border-b border-line/50 px-4 py-2.5 last:border-0 hover:bg-bg2"
            >
              <span className="flex-none rounded border border-line px-1.5 text-[9px] text-tx3">
                {it.kind === "pr" || it.kind === "pullrequest" ? "PR" : it.kind || "issue"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] text-tx">{it.title}</div>
                <div className="mt-0.5 text-[10px] text-tx3">
                  {it.repo}
                  {it.number ? `#${it.number}` : ""}
                  {it.author ? ` · ${it.author}` : ""}
                  {" · "}
                  {relTime(it.updatedAt)}
                </div>
              </div>
              <span className="flex-none text-[11px] text-tx3">↗</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

const LEVEL_OPACITY: Record<CalendarDay["level"], string> = {
  NONE: "var(--line)",
  FIRST_QUARTILE: "color-mix(in srgb, var(--acc) 16%, transparent)",
  SECOND_QUARTILE: "color-mix(in srgb, var(--acc) 30%, transparent)",
  THIRD_QUARTILE: "color-mix(in srgb, var(--acc) 48%, transparent)",
  FOURTH_QUARTILE: "color-mix(in srgb, var(--acc) 68%, transparent)",
};

function Heatmap({ weeks }: { weeks: CalendarDay[][] }) {
  // 周一~周日作为行标签（GitHub 日历周日为每周第一天）
  const dayLabels = ["日", "一", "三", "五"];
  return (
    <div>
      <div className="flex w-full gap-[3px]">
        {/* 周标签列 */}
        <div className="flex w-4 flex-none flex-col gap-[3px] text-[9px] text-tx3">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-[11px] leading-[11px]">
              {i % 2 === 1 ? dayLabels[(i + 1) / 2] ?? "" : ""}
            </div>
          ))}
        </div>
        {/* 网格：52 周均分容器宽度，窄屏也不出现横向滚动 */}
        <div className="flex min-w-0 flex-1 gap-[3px]">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex min-w-0 flex-1 flex-col gap-[3px]">
              {week.map((day) => (
                <div
                  key={day.date}
                  title={`${day.date} · ${day.count} contribution${day.count === 1 ? "" : "s"}`}
                  className="h-[11px] w-full rounded-[2px]"
                  style={{ backgroundColor: LEVEL_OPACITY[day.level] }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      {/* 图例 */}
      <div className="mt-2 flex items-center justify-end gap-1 text-[9px] text-tx3">
        <span>少</span>
        {(["NONE", "FIRST_QUARTILE", "SECOND_QUARTILE", "THIRD_QUARTILE", "FOURTH_QUARTILE"] as CalendarDay["level"][]).map((lv) => (
          <span
            key={lv}
            className="h-[11px] w-[11px] rounded-[2px]"
            style={{ backgroundColor: LEVEL_OPACITY[lv] }}
          />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}

// ── Tab 2 · 仓库列表 ────────────────────────────────────

function ReposGrid({
  repos,
  q,
  setQ,
  onOpen,
}: {
  repos: GhRepo[];
  q: string;
  setQ: (v: string) => void;
  onOpen: (r: GhRepo) => void;
}) {
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="过滤仓库…"
          className="w-44 rounded border border-line bg-bg1 px-2 py-1 text-[11px] text-tx outline-none placeholder:text-tx3 focus:border-acc"
        />
      </div>
      {repos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line py-16 text-center text-xs text-tx3">
          暂无仓库{q && `（过滤词：${q}）`}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {repos.map((r) => (
            <RepoCard key={r.id} repo={r} onClick={() => onOpen(r)} />
          ))}
        </div>
      )}
    </div>
  );
}

function RepoCard({ repo, onClick }: { repo: GhRepo; onClick: () => void }) {
  const [days, setDays] = useState<number[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ weeks: { total: number; days: number[] }[] }>(`/github/repos/${repo.owner}/${repo.name}/activity`)
      .then((r) => {
        if (cancelled) return;
        const flat = r.weeks.flatMap((w) => w.days);
        setDays(flat.slice(-30));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [repo.owner, repo.name]);

  return (
    <button
      onClick={onClick}
      className="group flex flex-col rounded-lg border border-line bg-bg1 p-3 text-left transition-all hover:border-acc hover:shadow-[0_0_12px_color-mix(in_srgb,var(--acc)_13%,transparent)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-bold text-acc">{repo.name}</span>
            {repo.private && <span className="flex-none rounded border border-line px-1 text-[9px] text-tx3">私有</span>}
            {repo.archived && <span className="flex-none rounded border border-warn/40 px-1 text-[9px] text-warn">归档</span>}
          </div>
          {repo.description && <div className="mt-1 line-clamp-2 text-[11px] text-tx3">{repo.description}</div>}
        </div>
        <a
          href={repo.htmlUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex-none text-[11px] text-tx3 opacity-0 transition-opacity group-hover:opacity-100"
        >
          ↗
        </a>
      </div>
      <div className="mt-3 flex items-center gap-3 text-[10px] text-tx3">
        {repo.language && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-acc/70" />
            {repo.language}
          </span>
        )}
        <span>★ {fmtNum(repo.stars)}</span>
        <span>⑂ {fmtNum(repo.forks)}</span>
        <span className="ml-auto">
          {repo.defaultBranch} · {relTime(repo.pushedAt)}
        </span>
      </div>
      {days && days.length > 0 && <Sparkline days={days} />}
    </button>
  );
}

/** 近 30 天提交 sparkline：手写 SVG，不引图表库 */
function Sparkline({ days }: { days: number[] }) {
  const max = Math.max(1, ...days);
  const total = days.reduce((s, d) => s + d, 0);
  const w = 150;
  const h = 18;
  const bw = w / days.length;
  return (
    <div className="mt-2 flex items-center gap-2" title={`近 30 天 ${total} 次提交`}>
      <svg width={w} height={h} className="w-full" preserveAspectRatio="none">
        {days.map((d, i) => {
          const bh = d === 0 ? 1 : Math.max(2, (d / max) * h);
          return (
            <rect
              key={i}
              x={i * bw}
              y={h - bh}
              width={Math.max(1, bw - 1)}
              height={bh}
              fill="var(--acc)"
              opacity={d === 0 ? 0.15 : 0.3 + (d / max) * 0.6}
            />
          );
        })}
      </svg>
      <span className="flex-none text-[9px] text-tx3">{total}/30d</span>
    </div>
  );
}

// ── 仓库详情 ────────────────────────────────────────────

function RepoDetail({ owner, name, onBack }: { owner: string; name: string; onBack: () => void }) {
  const [detail, setDetail] = useState<RepoDetailResp | null>(null);
  const [commits, setCommits] = useState<CommitItem[]>([]);
  const [tree, setTree] = useState<TreeResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [section, setSection] = useState<"readme" | "files" | "commits">("readme");

  useEffect(() => {
    setDetail(null);
    setCommits([]);
    setTree(null);
    setErr(null);
    Promise.all([
      api<RepoDetailResp>(`/github/repos/${owner}/${name}`),
      api<CommitsResp>(`/github/repos/${owner}/${name}/commits`),
      api<TreeResp>(`/github/repos/${owner}/${name}/tree`),
    ])
      .then(([d, c, t]) => {
        setDetail(d);
        setCommits(c.items);
        setTree(t);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "加载失败"));
  }, [owner, name]);

  return (
    <div>
      <button onClick={onBack} className="mb-3 text-[11px] text-tx3 hover:text-acc">
        ← 返回仓库列表
      </button>

      {err && <div className="mb-3 rounded border border-err/50 bg-err/5 px-3 py-2 text-[11px] text-err">{err}</div>}

      {detail && (
        <div className="mb-4 rounded-lg border border-line bg-bg1 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-[16px] font-bold text-acc">{detail.repo.fullName}</h2>
              {detail.repo.description && <p className="mt-1 text-[12px] text-tx2">{detail.repo.description}</p>}
            </div>
            <a
              href={detail.repo.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-none rounded border border-line px-2 py-1 text-[11px] text-tx3 hover:border-acc hover:text-acc"
            >
              ↗ github.com
            </a>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-tx3">
            {detail.repo.language && <span>● {detail.repo.language}</span>}
            <span>★ {fmtNum(detail.repo.stars)}</span>
            <span>⑂ {fmtNum(detail.repo.forks)}</span>
            <span>👁 {fmtNum(detail.repo.watchers)}</span>
            <span>issues {detail.repo.openIssues}</span>
            {detail.repo.license && <span>📜 {detail.repo.license}</span>}
            <span>pushed {relTime(detail.repo.pushedAt)}</span>
            {detail.ci && (
              <a
                href={detail.ci.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-1 hover:underline ${
                  detail.ci.conclusion === "failure"
                    ? "text-warn"
                    : detail.ci.conclusion === "success"
                      ? "text-acc"
                      : "text-tx3"
                }`}
                title={`CI: ${detail.ci.name} · ${detail.ci.conclusion ?? detail.ci.status}`}
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
                CI {detail.ci.conclusion ?? detail.ci.status}
              </a>
            )}
          </div>
          {detail.repo.topics.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {detail.repo.topics.map((t) => (
                <span key={t} className="rounded bg-acc/10 px-1.5 py-0.5 text-[10px] text-acc">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 子 tab */}
      <div className="mb-3 flex gap-1 border-b border-line">
        {([
          ["readme", "README"],
          ["files", "文件"],
          ["commits", "提交"],
        ] as [typeof section, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-[12px] transition-colors ${
              section === id ? "border-acc text-acc" : "border-transparent text-tx3 hover:text-tx"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {section === "readme" && (
        <div className="rounded-lg border border-line bg-bg1 p-4">
          {detail?.readme.content ? (
            <div className="text-[12.5px]">
              <MarkdownText text={detail.readme.content} />
            </div>
          ) : (
            <div className="py-8 text-center text-[11px] text-tx3">该仓库没有 README</div>
          )}
        </div>
      )}

      {section === "files" && tree && <FileTree tree={tree} owner={owner} name={name} />}

      {section === "commits" && (
        <div className="rounded-lg border border-line bg-bg1 p-4">
          {commits.length === 0 ? (
            <div className="py-8 text-center text-[11px] text-tx3">暂无提交</div>
          ) : (
            <ol className="space-y-3">
              {commits.map((c) => (
                <li key={c.sha} className="border-b border-line/50 last:border-0">
                  <a
                    href={c.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex gap-3 rounded px-1 py-1 hover:bg-bg2"
                  >
                    <code className="flex-none font-mono text-[11px] text-acc">{c.shortSha}</code>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] text-tx">{c.message}</div>
                      <div className="mt-0.5 text-[10px] text-tx3">
                        {c.author ?? c.login ?? "unknown"} · {relTime(c.date)}
                      </div>
                    </div>
                    <span className="flex-none text-[11px] text-tx3">↗</span>
                  </a>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

interface NestedNode {
  name: string;
  path: string;
  type: "blob" | "tree";
  size: number;
  children: NestedNode[];
}

function buildTree(nodes: TreeNode[]): NestedNode[] {
  const root: NestedNode[] = [];
  for (const n of nodes) {
    const parts = n.path.split("/");
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      let node = cur.find((c) => c.name === part);
      if (!node) {
        node = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          type: isLast ? n.type : "tree",
          size: isLast ? n.size : 0,
          children: [],
        };
        cur.push(node);
      }
      cur = node.children;
    }
  }
  const sortNodes = (arr: NestedNode[]) => {
    arr.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "tree" ? -1 : 1));
    arr.forEach((c) => sortNodes(c.children));
  };
  sortNodes(root);
  return root;
}

function FileTree({ tree, owner, name }: { tree: TreeResp; owner: string; name: string }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [fileContent, setFileContent] = useState<{ path: string; content: string } | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);

  const nested = useMemo(() => buildTree(tree.tree), [tree]);

  const toggle = (path: string) => setOpen((s) => ({ ...s, [path]: !s[path] }));

  const openFile = async (path: string) => {
    setFileContent(null);
    setFileErr(null);
    try {
      const data = await api<{ content: string; path: string }>(
        `/github/repos/${owner}/${name}/file?path=${encodeURIComponent(path)}`,
      );
      setFileContent(data);
    } catch (e) {
      setFileErr(e instanceof Error ? e.message : "读取失败");
    }
  };

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[280px_1fr]">
      <div className="max-h-[60vh] overflow-auto rounded-lg border border-line bg-bg1 p-2 text-[12px]">
        {tree.truncated && (
          <div className="mb-2 rounded border border-warn/40 bg-warn/5 px-2 py-1 text-[10px] text-warn">
            仓库过大，文件树已被 GitHub 截断，完整结构请 ↗ github.com
          </div>
        )}
        <ul className="space-y-0.5">
          {nested.map((n) => (
            <TreeRow key={n.path} node={n} depth={0} open={open} toggle={toggle} openFile={openFile} />
          ))}
        </ul>
      </div>
      <div className="min-h-[200px] rounded-lg border border-line bg-bg1 p-3">
        {fileContent ? (
          <div>
            <div className="mb-2 flex items-center justify-between border-b border-line pb-1.5 text-[11px] text-tx3">
              <span className="font-mono text-acc">{fileContent.path}</span>
              <button onClick={() => setFileContent(null)} className="text-tx3 hover:text-err">
                ✕
              </button>
            </div>
            <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-tx2">
              {fileContent.content}
            </pre>
          </div>
        ) : fileErr ? (
          <div className="py-8 text-center text-[11px] text-err">{fileErr}</div>
        ) : (
          <div className="py-12 text-center text-[11px] text-tx3">点击左侧文件查看正文（单文件上限 256KB）</div>
        )}
      </div>
    </div>
  );
}

function TreeRow({
  node,
  depth,
  open,
  toggle,
  openFile,
}: {
  node: NestedNode;
  depth: number;
  open: Record<string, boolean>;
  toggle: (p: string) => void;
  openFile: (p: string) => void;
}) {
  const isOpen = open[node.path];
  if (node.type === "tree") {
    return (
      <li>
        <button
          onClick={() => toggle(node.path)}
          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-tx2 hover:bg-bg2"
          style={{ paddingLeft: depth * 12 + 4 }}
        >
          <span className="text-tx3">{isOpen ? "▾" : "▸"}</span>
          <span className="text-acc">{node.name}</span>
        </button>
        {isOpen && (
          <ul className="space-y-0.5">
            {node.children.map((c) => (
              <TreeRow key={c.path} node={c} depth={depth + 1} open={open} toggle={toggle} openFile={openFile} />
            ))}
          </ul>
        )}
      </li>
    );
  }
  return (
    <li>
      <button
        onClick={() => openFile(node.path)}
        className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-tx2 hover:bg-bg2"
        style={{ paddingLeft: depth * 12 + 20 }}
      >
        <span className="text-tx3">📄</span>
        <span className="truncate">{node.name}</span>
        <span className="ml-auto text-[9px] text-tx3">{fmtBytes(node.size)}</span>
      </button>
    </li>
  );
}

// ── Tab 3 · 活跃（语言环 + 提交趋势） ───────────────────

const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Go: "#00ADD8",
  Python: "#3572A5",
  Rust: "#dea584",
  Java: "#b07219",
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Dart: "#00B4AB",
  Vue: "#41b883",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Shell: "#89e051",
  Dockerfile: "#384d54",
  Makefile: "#427819",
  Markdown: "#083fa1",
  JSON: "#292929",
  YAML: "#cb171e",
};
const FALLBACK_COLORS = ["#6e7681", "#8b949e", "#54aeff", "#a371f7", "#f78166", "#7ee787", "#ffa657"];

function langColor(lang: string, idx: number): string {
  return LANG_COLORS[lang] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
}

function ActivityTab() {
  const [langs, setLangs] = useState<LanguagesData | null>(null);
  const [cal, setCal] = useState<CalendarData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api<LanguagesData>("/github/activity/languages"), api<CalendarData>("/github/activity/calendar")])
      .then(([l, c]) => {
        setLangs(l);
        setCal(c);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "加载失败"));
  }, []);

  // 近 90 天 + 月度对比（从日历推导）
  const { last90, thisMonth, lastMonth } = useMemo(() => {
    if (!cal) return { last90: [] as { date: string; count: number }[], thisMonth: 0, lastMonth: 0 };
    const allDays = cal.weeks.flat();
    const now = new Date();
    const cutoff = new Date(now.getTime() - 90 * 86400000);
    const last90 = allDays.filter((d) => new Date(d.date) >= cutoff);
    const ym = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
    const thisYm = ym(now);
    const lastDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastYm = ym(lastDate);
    let thisMonth = 0;
    let lastMonth = 0;
    for (const d of allDays) {
      const dt = new Date(d.date);
      if (ym(dt) === thisYm) thisMonth += d.count;
      else if (ym(dt) === lastYm) lastMonth += d.count;
    }
    return { last90, thisMonth, lastMonth };
  }, [cal]);

  return (
    <div className="space-y-5">
      {err && <div className="rounded border border-err/50 bg-err/5 px-3 py-2 text-[11px] text-err">{err}</div>}

      {/* 语言环 */}
      <div className="rounded-lg border border-line bg-bg1 p-4">
        <h3 className="mb-3 text-[12px] font-semibold text-tx">语言占比</h3>
        {!langs ? (
          <div className="py-8 text-center text-[11px] text-tx3">加载中…</div>
        ) : langs.list.length === 0 ? (
          <div className="py-8 text-center text-[11px] text-tx3">暂无语言数据</div>
        ) : (
          <div className="flex flex-wrap items-center gap-6">
            <LanguageDonut list={langs.list} />
            <ul className="flex-1 space-y-1 text-[11px]">
              {langs.list.slice(0, 10).map((l, i) => (
                <li key={l.lang} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 flex-none rounded-sm" style={{ backgroundColor: langColor(l.lang, i) }} />
                  <span className="w-28 truncate text-tx2">{l.lang}</span>
                  <span className="text-tx3">{(l.pct * 100).toFixed(1)}%</span>
                  <span className="ml-auto text-tx3">{fmtBytes(l.bytes)}</span>
                </li>
              ))}
              {langs.list.length > 10 && (
                <li className="text-[10px] text-tx3">+{langs.list.length - 10} 种其它语言…</li>
              )}
            </ul>
          </div>
        )}
      </div>

      {/* 90 天提交柱 */}
      <div className="rounded-lg border border-line bg-bg1 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[12px] font-semibold text-tx">近 90 天每日贡献</h3>
          <div className="flex gap-4 text-[11px] text-tx3">
            <span>
              本月 <span className="text-acc">{thisMonth}</span>
            </span>
            <span>
              上月 <span className="text-acc">{lastMonth}</span>
            </span>
            <span className={thisMonth >= lastMonth ? "text-acc" : "text-warn"}>
              {lastMonth > 0 ? `${(((thisMonth - lastMonth) / lastMonth) * 100).toFixed(0)}%` : "—"}
            </span>
          </div>
        </div>
        {last90.length > 0 ? <CommitsBars days={last90} /> : <div className="py-8 text-center text-[11px] text-tx3">加载中…</div>}
      </div>
    </div>
  );
}

function LanguageDonut({ list }: { list: LangItem[] }) {
  const top = list.slice(0, 8);
  const rest = list.slice(8).reduce((s, l) => s + l.bytes, 0);
  const slices = [...top, ...(rest > 0 ? [{ lang: "其它", bytes: rest, pct: rest / (list[0] ? list.reduce((s, l) => s + l.bytes, 0) : 1) }] : [])];
  const total = slices.reduce((s, l) => s + l.bytes, 0) || 1;
  let acc = 0;
  const stops = slices.map((s, i) => {
    const start = (acc / total) * 360;
    acc += s.bytes;
    const end = (acc / total) * 360;
    const color = s.lang === "其它" ? "#30363d" : langColor(s.lang, i);
    return `${color} ${start}deg ${end}deg`;
  });
  return (
    <div className="relative h-36 w-36 flex-none">
      <div
        className="h-full w-full rounded-full"
        style={{ background: `conic-gradient(${stops.join(", ")})` }}
      />
      <div className="absolute inset-[22%] rounded-full bg-bg1" />
    </div>
  );
}

function CommitsBars({ days }: { days: { date: string; count: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const w = 720;
  const h = 80;
  const barW = w / days.length;
  return (
    <div>
      {/* viewBox + w-full：随容器缩放，不再固定 720px 触发横向滚动 */}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="h-20 w-full"
      >
        {days.map((d, i) => {
          const bh = (d.count / max) * (h - 4);
          return (
            <rect
              key={d.date}
              x={i * barW}
              y={h - bh}
              width={Math.max(1, barW - 1)}
              height={bh}
              fill="var(--acc)"
              opacity={0.3 + (d.count / max) * 0.7}
            >
              <title>{`${d.date} · ${d.count}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[9px] text-tx3">
        <span>{days[0]?.date.slice(5)}</span>
        <span>{days[Math.floor(days.length / 2)]?.date.slice(5)}</span>
        <span>{days[days.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}

// ── PAT 设置 ────────────────────────────────────────────

function PatSetup({
  account,
  onSaved,
  onRemoved,
}: {
  account?: GithubAccount;
  onSaved: () => void;
  onRemoved: () => void;
}) {
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim() || saving) return;
    setSaving(true);
    setErr(null);
    try {
      await api("/github/account/token", {
        method: "POST",
        body: JSON.stringify({ token: token.trim() }),
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm("确认移除 GitHub Token？所有本地快照将被清除。")) return;
    await api("/github/account", { method: "DELETE" });
    onRemoved();
  };

  return (
    <div className="mx-auto w-[min(640px,94%)] py-10 font-mono">
      <div className="mb-4 text-xs text-tx3">~/gh · GitHub 观察窗</div>
      <div className="rounded-lg border border-line bg-bg1 p-6">
        <h2 className="mb-1 text-[15px] font-bold text-tx">配置 GitHub Token</h2>
        <p className="mb-5 text-[11px] text-tx3">
          本面板为<strong className="text-tx2">只读观察窗</strong>，不会写任何数据到 GitHub。
        </p>

        {account?.status === "error" && account.lastError && (
          <div className="mb-4 rounded border border-err/50 bg-err/5 px-3 py-2 text-[11px] text-err">
            上一次校验失败：{account.lastError}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[11px] text-tx3">Personal Access Token</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={account?.tokenMasked ? `当前：${account.tokenMasked}` : "github_pat_… 或 ghp_…"}
              className="w-full rounded border border-line bg-bg px-3 py-2 text-[13px] text-tx outline-none placeholder:text-tx3 focus:border-acc"
              autoFocus
            />
          </div>

          <div className="rounded border border-dashed border-line p-3 text-[10px] leading-relaxed text-tx3">
            <div className="mb-1 text-tx2">推荐用 Fine-grained PAT，只勾只读权限：</div>
            Contents: Read · Metadata: Read · Pull requests: Read · Issues: Read · Actions: Read · Notifications: Read
            <div className="mt-1">
              创建地址：
              <a
                href="https://github.com/settings/tokens?type=beta"
                target="_blank"
                rel="noopener noreferrer"
                className="text-acc hover:underline"
              >
                github.com/settings/tokens ↗
              </a>
            </div>
          </div>

          {err && <div className="text-[11px] text-err">{err}</div>}

          <button
            type="submit"
            disabled={saving || !token.trim()}
            className="w-full rounded border border-acc bg-acc/10 py-2 text-[12px] text-acc transition-colors hover:bg-acc/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "校验中…" : "保存并校验"}
          </button>
        </form>

        {account && (
          <button onClick={remove} className="mt-3 w-full text-[10px] text-tx3 hover:text-err">
            移除当前账号并清除快照
          </button>
        )}
      </div>
    </div>
  );
}
