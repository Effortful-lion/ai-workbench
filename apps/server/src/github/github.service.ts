import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { DB, type Db } from "../db/db.module";
import { githubAccounts, githubSnapshots } from "../db/schema";
import { decrypt, encrypt } from "../common/crypto";
import { LlmAdapter } from "../llm/llm.adapter";
import { ModelsService } from "../models/models.service";

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";

type SnapshotKind =
  | "profile" | "repos" | "repo" | "readme" | "commits" | "tree" | "file"
  | "languages" | "contributions" | "inbox" | "notifications"
  | "runs" | "search_repos" | "digest" | "digest_stars";

interface Snapshot<T = unknown> {
  data: T;
  fetchedAt: Date;
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

/** 简报事件类型：每条必须能落到一个具体事件上，拒绝泛泛的仓库推荐 */
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

interface DigestCandidate extends DigestItem {
  repo: string;
}

const DIGEST_EVENT_PRIORITY: Record<DigestEventType, number> = {
  security: 100, ci: 90, release: 80, review: 70,
  issue: 65, star: 60, archived: 50, commit: 40, other: 20,
};

const DIGEST_EVENT_TYPES: readonly DigestEventType[] = [
  "release", "security", "star", "ci", "review", "issue", "archived", "commit", "other",
];

/** owner/repo 归一化：互斥与去重都以它为准 */
function digestRepoKey(repo: string | null | undefined): string {
  return (repo ?? "").trim().toLowerCase();
}

/** notification 的 subject.url 是 API 地址，转成网页深链；转不了就链到仓库页 */
function notifHtmlUrl(apiUrl: string | undefined, repoHtmlUrl: string | undefined): string {
  if (!apiUrl) return repoHtmlUrl ?? "https://github.com/notifications";
  const converted = apiUrl
    .replace("https://api.github.com/repos/", "https://github.com/")
    .replace(/\/pulls\/(\d+)$/, "/pull/$1")
    .replace(/\/issues\/(\d+)$/, "/issues/$1")
    .replace(/\/commits\/([0-9a-f]+)$/, "/commit/$1")
    .replace(/\/releases\/(\d+)$/, "/releases");
  return converted.startsWith("https://github.com/") ? converted : (repoHtmlUrl ?? "https://github.com/notifications");
}

/** 从 LLM 输出里宽容解析简报 JSON 数组 */
function parseDigestJson(content: string): DigestItem[] | null {
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return null;
    return arr
      .filter((x) => x && typeof x.text === "string")
      .map((x) => {
        const eventType = DIGEST_EVENT_TYPES.includes(String(x.eventType) as DigestEventType)
          ? (String(x.eventType) as DigestEventType)
          : "other";
        return {
          text: String(x.text).slice(0, 80),
          url: typeof x.url === "string" && x.url.startsWith("https://github.com") ? x.url : null,
          repo: typeof x.repo === "string" ? x.repo : null,
          eventType,
          eventAt: null,
        };
      });
  } catch {
    return null;
  }
}

/** GitHub 只读客户端 + 快照层。
 *  设计原则：只发 GET；所有数据先落 github_snapshots，UI/AI 只读快照；
 *  限流时返回旧快照并标 stale，绝不假装实时。 */
@Injectable()
export class GithubService {
  private readonly log = new Logger("github");

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly models: ModelsService,
    private readonly llm: LlmAdapter,
  ) {}

  // ── 账号 ──────────────────────────────────────────────

  async getAccount(ownerId: string) {
    const row = await this.db.query.githubAccounts.findFirst({
      where: eq(githubAccounts.ownerId, ownerId),
    });
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      status: row.status,
      lastError: row.lastError,
      updatedAt: row.updatedAt,
      tokenMasked: row.tokenEnc ? this.maskToken(decrypt(row.tokenEnc)) : null,
    };
  }

  async setToken(ownerId: string, token: string) {
    const clean = (token ?? "").trim();
    if (!clean) throw new NotFoundException("token 不能为空");
    const tokenEnc = encrypt(clean);
    const existing = await this.db.query.githubAccounts.findFirst({
      where: eq(githubAccounts.ownerId, ownerId),
    });
    let id: string;
    if (existing) {
      id = existing.id;
      await this.db
        .update(githubAccounts)
        .set({ tokenEnc, status: "untested", lastError: null, updatedAt: new Date() })
        .where(eq(githubAccounts.id, id));
    } else {
      id = randomUUID();
      await this.db.insert(githubAccounts).values({
        id, ownerId, tokenEnc, status: "untested",
      });
    }
    // 立刻校验 token：拉一次 profile，失败则标 error 但不回滚 token（用户可重填）
    try {
      await this.refreshProfile(ownerId, true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.db
        .update(githubAccounts)
        .set({ status: "error", lastError: msg, updatedAt: new Date() })
        .where(eq(githubAccounts.ownerId, ownerId));
      this.log.warn(`github token 校验失败: ${msg}`);
    }
    return this.getAccount(ownerId);
  }

  async removeAccount(ownerId: string) {
    await this.db.delete(githubAccounts).where(eq(githubAccounts.ownerId, ownerId));
    await this.db.delete(githubSnapshots).where(eq(githubSnapshots.ownerId, ownerId));
    return { removed: true };
  }

  private async requireToken(ownerId: string): Promise<string> {
    const row = await this.db.query.githubAccounts.findFirst({
      where: eq(githubAccounts.ownerId, ownerId),
    });
    if (!row?.tokenEnc) throw new NotFoundException("尚未配置 GitHub Token，请先在 GitHub 观察窗设置");
    return decrypt(row.tokenEnc);
  }

  // ── 快照取数 ───────────────────────────────────────────

  /** 通用：命中未过期→返回；否则带 ETag 请求，304 仅更新时间，限流返回 stale */
  private async fetchSnapshot<T>(
    ownerId: string,
    kind: SnapshotKind,
    key: string,
    path: string,
    ttlMs: number,
    parser: (json: unknown) => T,
  ): Promise<Snapshot<T>> {
    const now = new Date();
    const existing = await this.db.query.githubSnapshots.findFirst({
      where: and(eq(githubSnapshots.ownerId, ownerId), eq(githubSnapshots.kind, kind), eq(githubSnapshots.key, key)),
    });

    if (existing && existing.expiresAt > now) {
      // 快照存的是解析后的数据，直接返回，不能再过 parser（字段名已转换，重复解析会丢字段）
      return { data: JSON.parse(existing.payload) as T, fetchedAt: existing.fetchedAt, stale: false };
    }

    const token = await this.requireToken(ownerId);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
    };
    if (existing?.etag) headers["If-None-Match"] = existing.etag;

    let res: Response;
    try {
      res = await fetch(`${API}${path}`, { headers });
    } catch (e) {
      // 网络失败：有旧快照就返回 stale
      if (existing) return { data: JSON.parse(existing.payload) as T, fetchedAt: existing.fetchedAt, stale: true };
      throw e;
    }

    // 304：内容未变，只刷新时间（必须先于 !res.ok 判断，304 的 res.ok 是 false）
    if (res.status === 304 && existing) {
      const fetchedAt = new Date();
      await this.db
        .update(githubSnapshots)
        .set({ fetchedAt, expiresAt: new Date(fetchedAt.getTime() + ttlMs) })
        .where(eq(githubSnapshots.id, existing.id));
      return { data: JSON.parse(existing.payload) as T, fetchedAt, stale: false };
    }

    // 限流 / 服务器错误：沿用旧快照
    if ((res.status === 403 || res.status === 429 || res.status >= 500) && existing) {
      this.log.warn(`github ${kind}/${key} ${res.status}，返回旧快照`);
      return { data: JSON.parse(existing.payload) as T, fetchedAt: existing.fetchedAt, stale: true };
    }
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text().catch(() => "")}`);

    const json = await res.json();
    const etag = res.headers.get("etag") ?? undefined;
    const data = parser(json);
    const fetchedAt = new Date();
    const payload = JSON.stringify(data);

    if (existing) {
      await this.db
        .update(githubSnapshots)
        .set({ payload, etag, fetchedAt, expiresAt: new Date(fetchedAt.getTime() + ttlMs) })
        .where(eq(githubSnapshots.id, existing.id));
    } else {
      await this.db.insert(githubSnapshots).values({
        id: randomUUID(), ownerId, kind, key, payload, etag,
        fetchedAt, expiresAt: new Date(fetchedAt.getTime() + ttlMs),
      });
    }
    return { data, fetchedAt, stale: false };
  }

  // ── 对外数据 ───────────────────────────────────────────

  async profile(ownerId: string, force = false) {
    if (force) await this.invalidate(ownerId, "profile", "");
    const snap = await this.fetchSnapshot(ownerId, "profile", "", "/user", 30 * 60 * 1000, (j: any) => ({
      login: j.login,
      name: j.name,
      avatarUrl: j.avatar_url,
      bio: j.bio,
      publicRepos: j.public_repos,
      followers: j.followers,
      following: j.following,
      htmlUrl: j.html_url,
    }));
    // 回填用户名 + 状态
    await this.db
      .update(githubAccounts)
      .set({ username: snap.data.login, status: "ok", lastError: null, updatedAt: new Date() })
      .where(eq(githubAccounts.ownerId, ownerId))
      .catch(() => {});
    return snap;
  }

  private refreshProfile(ownerId: string, force: boolean) {
    return this.profile(ownerId, force);
  }

  /** 仓库列表。q 为本地过滤（在「我的仓库」内搜），不发 GitHub search 请求 */
  async repos(ownerId: string, q?: string, force = false) {
    if (force) await this.invalidate(ownerId, "repos", "");
    // 个人仓库：/user/repos?per_page=100&sort=pushed
    const snap = await this.fetchSnapshot<any[]>(
      ownerId, "repos", "", "/user/repos?per_page=100&sort=pushed", 15 * 60 * 1000,
      (j: any) => (Array.isArray(j) ? j : []),
    );
    let list = snap.data.map((r: any) => ({
      id: r.id,
      fullName: r.full_name,
      name: r.name,
      owner: r.owner?.login,
      description: r.description,
      language: r.language,
      stars: r.stargazers_count,
      forks: r.forks_count,
      private: r.private,
      archived: r.archived,
      defaultBranch: r.default_branch,
      pushedAt: r.pushed_at,
      htmlUrl: r.html_url,
    }));
    if (q) {
      const needle = q.trim().toLowerCase();
      list = list.filter((r) =>
        !needle ||
        r.fullName.toLowerCase().includes(needle) ||
        (r.description ?? "").toLowerCase().includes(needle) ||
        (r.language ?? "").toLowerCase().includes(needle),
      );
    }
    return { ...snap, data: list };
  }

  // ── 贡献日历（GraphQL） ─────────────────────────────────

  /** 53 周贡献日历。走 GraphQL（独立额度），TTL 24h。 */
  async calendar(ownerId: string, force = false) {
    if (force) await this.invalidate(ownerId, "contributions", "");
    const snap = await this.getSnapshot(ownerId, "contributions", "");
    if (snap) return snap;

    const acct = await this.db.query.githubAccounts.findFirst({ where: eq(githubAccounts.ownerId, ownerId) });
    let login = acct?.username;
    if (!login) {
      const p = await this.profile(ownerId);
      login = p.data.login;
    }
    const token = await this.requireToken(ownerId);
    const query = `query($user: String!) {
      user(login: $user) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks { contributionDays { date contributionCount contributionLevel } }
          }
        }
      }
    }`;
    const res = await fetch(`${API}/graphql`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { user: login } }),
    });
    if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}`);
    const json: any = await res.json();
    const cal = json?.data?.user?.contributionsCollection?.contributionCalendar;
    if (!cal) throw new Error(json?.errors?.[0]?.message ?? "无法获取贡献日历");
    const data = {
      total: cal.totalContributions as number,
      weeks: (cal.weeks as any[]).map((w) =>
        w.contributionDays.map((d: any) => ({ date: d.date, count: d.contributionCount, level: d.contributionLevel })),
      ),
    };
    return this.putSnapshot(ownerId, "contributions", "", data, 24 * 60 * 60 * 1000);
  }

  // ── 语言占比（聚合所有仓库） ────────────────────────────

  /** 遍历个人仓库的 /languages，累加字节。L3，TTL 24h。 */
  async languages(ownerId: string, force = false) {
    if (force) await this.invalidate(ownerId, "languages", "");
    const snap = await this.getSnapshot(ownerId, "languages", "");
    if (snap) return snap;

    const reposSnap = await this.repos(ownerId);
    const token = await this.requireToken(ownerId);
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
    };
    const agg: Record<string, number> = {};
    let total = 0;
    for (const r of reposSnap.data) {
      try {
        const res = await fetch(`${API}/repos/${r.fullName}/languages`, { headers });
        if (!res.ok) continue;
        const j = (await res.json()) as Record<string, number>;
        for (const [lang, bytes] of Object.entries(j)) {
          agg[lang] = (agg[lang] ?? 0) + bytes;
          total += bytes;
        }
      } catch {
        /* 单仓库失败跳过 */
      }
    }
    const list = Object.entries(agg)
      .map(([lang, bytes]) => ({ lang, bytes, pct: total ? bytes / total : 0 }))
      .sort((a, b) => b.bytes - a.bytes);
    return this.putSnapshot(ownerId, "languages", "", { total, list }, 24 * 60 * 60 * 1000);
  }

  // ── 单仓库详情族 ────────────────────────────────────────

  private repoKey(owner: string, name: string) {
    return `${owner}/${name}`;
  }

  /** 仓库元信息 */
  async repo(ownerId: string, owner: string, name: string, force = false) {
    const key = this.repoKey(owner, name);
    if (force) await this.invalidate(ownerId, "repo", key);
    return this.fetchSnapshot(ownerId, "repo", key, `/repos/${owner}/${name}`, 30 * 60 * 1000, (j: any) => ({
      id: j.id,
      fullName: j.full_name,
      name: j.name,
      owner: j.owner?.login,
      description: j.description,
      language: j.language,
      stars: j.stargazers_count,
      forks: j.forks_count,
      watchers: j.subscribers_count,
      openIssues: j.open_issues_count,
      defaultBranch: j.default_branch,
      private: j.private,
      archived: j.archived,
      topics: j.topics as string[],
      license: j.license?.spdx_id ?? null,
      createdAt: j.created_at,
      pushedAt: j.pushed_at,
      updatedAt: j.updated_at,
      htmlUrl: j.html_url,
    }));
  }

  /** README 正文（解码 base64） */
  async readme(ownerId: string, owner: string, name: string, force = false) {
    const key = this.repoKey(owner, name);
    if (force) await this.invalidate(ownerId, "readme", key);
    return this.fetchSnapshot(ownerId, "readme", key, `/repos/${owner}/${name}/readme`, 60 * 60 * 1000, (j: any) => {
      const content = j?.content ? Buffer.from(j.content, "base64").toString("utf-8") : "";
      return { content, path: j?.path ?? "README.md", htmlUrl: j?.html_url };
    });
  }

  /** 最近提交 */
  async commits(ownerId: string, owner: string, name: string, force = false) {
    const key = this.repoKey(owner, name);
    if (force) await this.invalidate(ownerId, "commits", key);
    return this.fetchSnapshot(
      ownerId, "commits", key, `/repos/${owner}/${name}/commits?per_page=15`, 30 * 60 * 1000,
      (j: any) => (Array.isArray(j) ? j : []).map((c: any) => ({
        sha: c.sha,
        shortSha: c.sha?.slice(0, 7),
        message: c.commit?.message,
        author: c.commit?.author?.name ?? c.author?.login ?? null,
        login: c.author?.login ?? null,
        date: c.commit?.author?.date,
        htmlUrl: c.html_url,
      })),
    );
  }

  /** 文件树（递归） */
  async tree(ownerId: string, owner: string, name: string, force = false) {
    const key = this.repoKey(owner, name);
    if (force) await this.invalidate(ownerId, "tree", key);
    return this.fetchSnapshot(
      ownerId, "tree", key, `/repos/${owner}/${name}/git/trees/HEAD?recursive=1`, 60 * 60 * 1000,
      (j: any) => ({
        truncated: j.truncated === true,
        tree: (j.tree ?? []).map((t: any) => ({ path: t.path, type: t.type, size: t.size ?? 0 })),
      }),
    );
  }

  /** 单文件正文（>256KB 拒绝）。不走长缓存，TTL 5min。 */
  async file(ownerId: string, owner: string, name: string, path: string) {
    const key = `${owner}/${name}:${path}`;
    const snap = await this.getSnapshot(ownerId, "file", key);
    if (snap) return snap;
    const token = await this.requireToken(ownerId);
    // 逐段编码，保留路径分隔符 /（encodeURIComponent 会把 / 变成 %2F）
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`${API}/repos/${owner}/${name}/contents/${encoded}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.raw",
        "X-GitHub-Api-Version": API_VERSION,
      },
    });
    if (res.status === 404) throw new NotFoundException(`文件不存在：${path}`);
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const content = await res.text();
    if (content.length > 256 * 1024) throw new Error(`文件过大（${(content.length / 1024).toFixed(0)}KB > 256KB），请去 GitHub 查看`);
    return this.putSnapshot(ownerId, "file", key, { content, path }, 5 * 60 * 1000);
  }

  /** 最新一次 workflow run 结论。随 L2 详情一起取；Actions 未启用/无权限时静默为 null。 */
  private async ciRun(ownerId: string, owner: string, name: string, force = false): Promise<Snapshot<{
    repo: string;
    conclusion: string | null;
    status: string;
    name: string;
    htmlUrl: string;
    updatedAt: string;
  } | null>> {
    const key = this.repoKey(owner, name);
    if (force) await this.invalidate(ownerId, "runs", key);
    try {
      return await this.fetchSnapshot(
        ownerId, "runs", key, `/repos/${owner}/${name}/actions/runs?per_page=1`, 30 * 60 * 1000,
        (j: any) => {
          const run = j?.workflow_runs?.[0];
          if (!run) return null;
          return {
            repo: key,
            conclusion: run.conclusion ?? null,
            status: run.status,
            name: run.name,
            htmlUrl: run.html_url,
            updatedAt: run.updated_at,
          };
        },
      );
    } catch {
      return { data: null, fetchedAt: new Date(), stale: true };
    }
  }

  /** 详情聚合：meta + README + CI 状态 */
  async repoDetail(ownerId: string, owner: string, name: string, force = false) {
    const [repo, readme, ci] = await Promise.all([
      this.repo(ownerId, owner, name, force),
      this.readme(ownerId, owner, name, force).catch(() => ({ data: { content: "", path: "README.md", htmlUrl: null }, fetchedAt: new Date(), stale: true })),
      this.ciRun(ownerId, owner, name, force),
    ]);
    return {
      repo: repo.data,
      readme: readme.data,
      ci: ci.data,
      fetchedAt: repo.fetchedAt,
      stale: repo.stale || readme.stale,
    };
  }

  // ── 收件（待 review / 指派给我 / 未读通知） ──────────────

  /** L1 聚合快照：2 条 search + notifications，TTL 15min。各源独立容错。 */
  async inbox(ownerId: string, force = false) {
    if (force) await this.invalidate(ownerId, "inbox", "");
    let snap = await this.getSnapshot<{
      reviewRequested: InboxItem[];
      assigned: InboxItem[];
      notifications: InboxItem[];
    }>(ownerId, "inbox", "");

    if (!snap) {
      const token = await this.requireToken(ownerId);
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
      };
      const searchItems = async (q: string): Promise<InboxItem[]> => {
        const res = await fetch(`${API}/search/issues?q=${encodeURIComponent(q)}&per_page=20&sort=updated&order=desc`, { headers });
        if (!res.ok) throw new Error(`GitHub search ${res.status}`);
        const j: any = await res.json();
        return (j.items ?? []).map((it: any) => ({
          title: it.title,
          htmlUrl: it.html_url,
          repo: (it.repository_url as string)?.replace("https://api.github.com/repos/", "") ?? "",
          number: it.number,
          kind: it.pull_request ? "pr" : "issue",
          author: it.user?.login ?? null,
          updatedAt: it.updated_at,
        }));
      };
      const notifItems = async (): Promise<InboxItem[]> => {
        const res = await fetch(`${API}/notifications?per_page=30`, { headers });
        if (!res.ok) throw new Error(`GitHub notifications ${res.status}`);
        const j: any = await res.json();
        return (Array.isArray(j) ? j : []).map((n: any) => ({
          title: n.subject?.title ?? "",
          htmlUrl: notifHtmlUrl(n.subject?.url, n.repository?.html_url),
          repo: n.repository?.full_name ?? "",
          kind: (n.subject?.type ?? "").toLowerCase(),
          reason: n.reason ?? null,
          updatedAt: n.updated_at,
        }));
      };
      // 各源独立容错：单源失败置空，不拖垮整个收件
      const [review, assigned, notif] = await Promise.all([
        searchItems("is:pr is:open review-requested:@me").catch(() => [] as InboxItem[]),
        searchItems("is:issue is:open assignee:@me").catch(() => [] as InboxItem[]),
        notifItems().catch(() => [] as InboxItem[]),
      ]);
      snap = await this.putSnapshot(ownerId, "inbox", "", { reviewRequested: review, assigned, notifications: notif }, 15 * 60 * 1000);
    }

    // 需关注：从已缓存的 runs 快照推导 CI 失败仓库，零额外请求
    const runRows = await this.db.query.githubSnapshots.findMany({
      where: and(eq(githubSnapshots.ownerId, ownerId), eq(githubSnapshots.kind, "runs")),
    });
    const ciFailing = runRows
      .map((r) => {
        try { return JSON.parse(r.payload); } catch { return null; }
      })
      .filter((p) => p && p.conclusion === "failure")
      .map((p) => ({ repo: p.repo as string, htmlUrl: p.htmlUrl as string }));

    return { ...snap, data: { ...snap.data, ciFailing } };
  }

  // ── AI 今日简报 ────────────────────────────────────────

  /** 4–5 条事件型简报：与热门榜按 owner/repo 互斥，内部同仓库只出现一次。
   *  LLM 只做筛选与措辞；候选、事件类型、链接都来自确定性数据，失败时回退同一份候选。
   *  候选来源：通知 / 待 review / 指派 / CI / star 增速 / 归档 / 近 30 天 push。
   *  生成后落库：非空 30 分钟；空结果 5 分钟，避免长时间锁死空简报。 */
  async digest(ownerId: string, force = false) {
    if (force) await this.invalidate(ownerId, "digest", "");
    const snap = await this.getSnapshot<{
      items: DigestItem[];
      source: "llm" | "rule";
      excludedTrending: string[];
    }>(ownerId, "digest", "");
    if (snap) return snap;

    const inboxSnap = await this.inbox(ownerId);
    const d = inboxSnap.data;

    // 热门新项目榜失败不影响简报（fine-grained 令牌也能用 search，但网络异常时容错）
    let trendingItems: { fullName: string; stars: number; url: string }[] = [];
    try {
      const t = await this.trending(ownerId);
      trendingItems = (t.data.items ?? []).map((r: any) => ({ fullName: r.fullName, stars: r.stars, url: r.url }));
    } catch (e) {
      this.log.warn(`digest 获取热门榜失败: ${(e as Error).message}`);
    }
    const excluded = new Set(trendingItems.map((r) => digestRepoKey(r.fullName)));

    // 用户仓库：用于 star 增速与归档事件；失败不影响简报
    let repoList: any[] = [];
    try {
      repoList = (await this.repos(ownerId)).data;
    } catch (e) {
      this.log.warn(`digest 获取仓库列表失败: ${(e as Error).message}`);
    }

    const starEvents = await this.buildStarEvents(ownerId, repoList);
    const candidates = this.buildDigestCandidates(d, repoList, starEvents, excluded);
    const fallback = candidates.slice(0, 5);

    let items: DigestItem[] = fallback;
    let source: "llm" | "rule" = "rule";
    try {
      const realModels = await this.models.listRealModels();
      const model = realModels[0];
      if (model && candidates.length > 0) {
        const resp = await this.llm.chat({
          endpoint: model.endpoint,
          apiKey: model.apiKey,
          model: model.modelName,
          temperature: 0.2,
          timeoutMs: 20_000,
          messages: [
            {
              role: "system",
              content:
                "你是 GitHub 观察窗的事件型简报生成器。只能从 candidates 中选择，不得虚构仓库、事件或链接。" +
                "目标 4–5 条（候选足够时至少 4 条），最多 5 条。" +
                "每个 owner/repo 只出现一次；repo 出现在 excludedTrending 中时一律不得选择。" +
                "每条必须锚定一个具体事件（release/security/star/ci/review/issue/archived/commit），" +
                "不要泛泛推荐仓库，不要写“值得关注”“很受欢迎”这类没有事件锚点的判断。" +
                "每条一句话中文，不超过 45 字；url 必须使用候选里提供的链接；eventType 必须与候选一致。" +
                '严格输出 JSON 数组：[{"text":"...","url":"https://github.com/...","repo":"owner/repo","eventType":"release"}]。' +
                "候选不足时返回实际可用条数；没有候选就输出 []。不要输出任何其它文字。",
            },
            {
              role: "user",
              content: JSON.stringify({
                now: new Date().toISOString(),
                candidates: candidates.slice(0, 12),
                excludedTrending: [...excluded],
              }),
            },
          ],
        });
        const parsed = parseDigestJson(resp.content);
        if (parsed) {
          const selected = this.normalizeDigestItems(parsed, excluded, candidates);
          if (selected.length > 0) {
            items = this.ensureDigestCount(selected, fallback, Math.min(4, candidates.length));
            source = "llm";
          }
        }
      }
    } catch (e) {
      this.log.warn(`digest llm 失败，回退规则模板: ${(e as Error).message}`);
    }
    // 空简报只缓存 5 分钟：新通知/新提交进来后不必等满 30 分钟
    const ttl = items.length === 0 ? 5 * 60 * 1000 : 30 * 60 * 1000;
    return this.putSnapshot(ownerId, "digest", "", { items, source, excludedTrending: [...excluded] }, ttl);
  }

  /** star 增速：首次运行只写基线；之后与基线对比，7 天后自动重置。 */
  private async buildStarEvents(ownerId: string, repos: any[]): Promise<DigestCandidate[]> {
    if (repos.length === 0) return [];
    const prev = await this.getSnapshot<Record<string, number>>(ownerId, "digest_stars", "");
    const current: Record<string, number> = {};
    for (const r of repos) {
      const key = digestRepoKey(r.fullName);
      if (key) current[key] = Number(r.stars) || 0;
    }
    if (!prev) {
      await this.putSnapshot(ownerId, "digest_stars", "", current, 7 * 24 * 60 * 60 * 1000);
      return [];
    }

    const out: DigestCandidate[] = [];
    for (const r of repos) {
      const key = digestRepoKey(r.fullName);
      const before = prev.data[key];
      const now = Number(r.stars) || 0;
      if (!key || before === undefined || now <= before) continue;
      const delta = now - before;
      const pct = before > 0 ? Math.round((delta / before) * 100) : 100;
      if (delta < 50 && pct < 10) continue;
      out.push({
        text: `近 7 天 star +${delta.toLocaleString()}（${pct}%）：${r.fullName}`,
        url: r.htmlUrl ?? null,
        repo: r.fullName,
        eventType: "star",
        eventAt: null,
      });
    }
    return out;
  }

  /** 把收件、CI、仓库状态整理成事件候选；同仓库只保留优先级最高的一条。 */
  private buildDigestCandidates(
    d: {
      reviewRequested: InboxItem[];
      assigned: InboxItem[];
      notifications: InboxItem[];
      ciFailing: { repo: string; htmlUrl: string }[];
    },
    repos: any[],
    starEvents: DigestCandidate[],
    excluded: Set<string>,
  ): DigestCandidate[] {
    const raw: DigestCandidate[] = [];

    for (const n of d.notifications) {
      if (!digestRepoKey(n.repo)) continue;
      const eventType = this.notificationEventType(n);
      raw.push({
        text: this.notificationText(eventType, n.repo, (n.title ?? "").trim().slice(0, 34)),
        url: n.htmlUrl || null,
        repo: n.repo,
        eventType,
        eventAt: n.updatedAt || null,
      });
    }

    const seenReview = new Set<string>();
    for (const it of d.reviewRequested) {
      const key = digestRepoKey(it.repo);
      if (!key || seenReview.has(key)) continue;
      seenReview.add(key);
      raw.push({
        text: `${it.repo}#${it.number ?? "?"} 等待你 review`,
        url: it.htmlUrl || null,
        repo: it.repo,
        eventType: "review",
        eventAt: it.updatedAt || null,
      });
      if (seenReview.size >= 2) break;
    }

    const seenAssigned = new Set<string>();
    for (const it of d.assigned) {
      const key = digestRepoKey(it.repo);
      if (!key || seenAssigned.has(key)) continue;
      seenAssigned.add(key);
      raw.push({
        text: `指派给你：${it.repo}#${it.number ?? "?"} ${(it.title ?? "").slice(0, 18)}`,
        url: it.htmlUrl || null,
        repo: it.repo,
        eventType: "issue",
        eventAt: it.updatedAt || null,
      });
      if (seenAssigned.size >= 2) break;
    }

    for (const c of d.ciFailing.slice(0, 2)) {
      raw.push({
        text: `CI 失败：${c.repo}`,
        url: c.htmlUrl || null,
        repo: c.repo,
        eventType: "ci",
        eventAt: null,
      });
    }

    raw.push(...starEvents);

    for (const r of repos.filter((x) => x.archived === true).slice(0, 1)) {
      raw.push({
        text: `仓库已归档：${r.fullName}`,
        url: r.htmlUrl ?? null,
        repo: r.fullName,
        eventType: "archived",
        eventAt: null,
      });
    }

    // 收件/CI/star 全空时的兜底事件源：近 30 天有 push 的仓库，锚点是最近一次提交时间
    raw.push(...this.buildPushCandidates(repos));

    const byRepo = new Map<string, DigestCandidate>();
    for (const c of raw) {
      const key = digestRepoKey(c.repo);
      if (!key || excluded.has(key)) continue;
      const prev = byRepo.get(key);
      if (!prev || this.candidateScore(c) > this.candidateScore(prev)) byRepo.set(key, c);
    }
    return [...byRepo.values()].sort((a, b) => this.candidateScore(b) - this.candidateScore(a));
  }

  /** 近 30 天有 push 的仓库 → commit 事件；用于收件、CI、star 都没有数据时兜底，避免简报全空 */
  private buildPushCandidates(repos: any[]): DigestCandidate[] {
    const DAY = 24 * 60 * 60 * 1000;
    const out: DigestCandidate[] = [];
    for (const r of repos) {
      if (!r?.fullName || !r?.pushedAt) continue;
      const ts = new Date(r.pushedAt).getTime();
      if (!Number.isFinite(ts)) continue;
      const age = Date.now() - ts;
      if (age < 0 || age > 30 * DAY) continue;
      const days = Math.max(1, Math.round(age / DAY));
      out.push({
        text: days <= 1 ? `今天有新提交：${r.fullName}` : `近 ${days} 天有新提交：${r.fullName}`,
        url: r.htmlUrl ?? null,
        repo: r.fullName,
        eventType: "commit",
        eventAt: r.pushedAt,
      });
    }
    return out;
  }

  private candidateScore(c: DigestCandidate): number {
    const base = DIGEST_EVENT_PRIORITY[c.eventType] ?? 0;
    if (!c.eventAt) return base;
    const age = Date.now() - new Date(c.eventAt).getTime();
    if (!Number.isFinite(age)) return base;
    if (age <= 24 * 60 * 60 * 1000) return base + 10;
    if (age <= 7 * 24 * 60 * 60 * 1000) return base + 5;
    return base;
  }

  private notificationEventType(n: InboxItem): DigestEventType {
    const kind = (n.kind || "").toLowerCase();
    if (kind.includes("release")) return "release";
    if (kind.includes("vulnerability") || kind.includes("security") || n.reason === "security_alert") return "security";
    if (kind.includes("commit")) return "commit";
    if (kind.includes("check") || kind.includes("workflow")) return "ci";
    if (kind.includes("pullrequest") || kind.includes("pull_request") || kind === "pr") return "issue";
    if (kind.includes("issue") || kind.includes("discussion")) return "issue";
    return "other";
  }

  private notificationText(type: DigestEventType, repo: string, title: string): string {
    const suffix = title ? `：${title}` : "";
    switch (type) {
      case "security": return `${repo} 安全公告${suffix}`;
      case "release": return `${repo} 发布新版本${suffix}`;
      case "commit": return `${repo} 有新提交${suffix}`;
      case "ci": return `${repo} CI 状态变化${suffix}`;
      default: return `${repo} 有新的活动${suffix}`;
    }
  }

  /** 只保留候选中的仓库，事件类型与链接以候选为准，避免模型虚构或错标。 */
  private normalizeDigestItems(
    items: DigestItem[],
    excluded: Set<string>,
    candidates: DigestCandidate[],
  ): DigestItem[] {
    const byRepo = new Map(candidates.map((c) => [digestRepoKey(c.repo), c]));
    const out = new Map<string, DigestItem>();
    for (const raw of items) {
      const key = digestRepoKey(raw.repo);
      if (!key || excluded.has(key)) continue;
      const cand = byRepo.get(key);
      if (!cand) continue;
      const text = raw.text.trim().slice(0, 80);
      if (!text) continue;
      if (!out.has(key)) {
        out.set(key, {
          text,
          url: raw.url ?? cand.url,
          repo: cand.repo,
          eventType: cand.eventType,
          eventAt: cand.eventAt,
        });
      }
    }
    return [...out.values()];
  }

  /** LLM 少给条数时用同一份候选补齐到 4 条，保证兜底也满足同样的条数与去重规则。 */
  private ensureDigestCount(selected: DigestItem[], fallback: DigestItem[], minCount: number): DigestItem[] {
    const out = [...selected];
    const keys = new Set(out.map((i) => digestRepoKey(i.repo)));
    for (const c of fallback) {
      if (out.length >= minCount || out.length >= 5) break;
      const key = digestRepoKey(c.repo);
      if (!key || keys.has(key)) continue;
      out.push(c);
      keys.add(key);
    }
    return out.slice(0, 5);
  }

  // ── 全站仓库搜索 ───────────────────────────────────────

  /** 只发一页不翻页（per_page=10），同 query 快照 5 分钟。结果带 pushedAt/archived 判断信号。 */
  async searchRepos(ownerId: string, q: string, sort?: string, force = false) {
    const query = (q ?? "").trim();
    if (!query) throw new NotFoundException("q 不能为空");
    const sortKey = sort === "stars" || sort === "updated" ? sort : "best";
    const key = `${query}::${sortKey}`;
    if (force) await this.invalidate(ownerId, "search_repos", key);
    const sortParam = sortKey === "best" ? "" : `&sort=${sortKey}&order=desc`;
    return this.fetchSnapshot(
      ownerId, "search_repos", key,
      `/search/repositories?q=${encodeURIComponent(query)}&per_page=10${sortParam}`,
      5 * 60 * 1000,
      (j: any) => ({
        total: j.total_count ?? 0,
        items: (j.items ?? []).map((r: any) => ({
          fullName: r.full_name,
          description: r.description,
          stars: r.stargazers_count,
          forks: r.forks_count,
          language: r.language,
          pushedAt: r.pushed_at,
          archived: r.archived === true,
          topics: (r.topics ?? []).slice(0, 6),
          url: r.html_url,
        })),
      }),
    );
  }

  /** 52 周提交活动（stats/commit_activity），TTL 24h。
   *  GitHub 首次统计返回 202（后台计算中），此时给空数组并标 stale，下个周期自然补上。 */
  async commitActivity(ownerId: string, owner: string, name: string, force = false) {
    const key = `${this.repoKey(owner, name)}::activity52`;
    if (force) await this.invalidate(ownerId, "commits", key);
    const cached = await this.getSnapshot<{ weeks: { total: number; days: number[] }[] }>(ownerId, "commits", key);
    if (cached) return cached;

    const token = await this.requireToken(ownerId);
    const res = await fetch(`${API}/repos/${owner}/${name}/stats/commit_activity`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
      },
    });
    if (res.status === 202) {
      // 统计计算中：短缓存 10 分钟空数组，避免每次打开都触发
      return this.putSnapshot(ownerId, "commits", key, { weeks: [] }, 10 * 60 * 1000);
    }
    if (res.status === 404) throw new NotFoundException(`仓库不存在或无权限：${owner}/${name}`);
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    // GitHub 统计计算期间偶发 200 + 空 body，按 202 同样处理
    const j: any = await res.json().catch(() => null);
    if (j == null) {
      return this.putSnapshot(ownerId, "commits", key, { weeks: [] }, 10 * 60 * 1000);
    }
    const weeks = (Array.isArray(j) ? j : []).map((w: any) => ({
      total: w.total ?? 0,
      days: (Array.isArray(w.days) ? w.days : []).map((d: any) => Number(d) || 0),
    }));
    return this.putSnapshot(ownerId, "commits", key, { weeks }, 24 * 60 * 60 * 1000);
  }

  // ── 代码搜索（10 req/min 单独限速） ─────────────────────

  /** 滑动窗口：代码搜索独立限速 10 次/分钟（单用户足够） */
  private codeSearchHits: number[] = [];

  /** 「我哪个项目里写过 X」。只发一页 10 条；命中快照不占限速额度。 */
  async searchCode(ownerId: string, q: string) {
    const query = (q ?? "").trim();
    if (!query) throw new NotFoundException("q 不能为空");
    const key = `code::${query}`;
    const cached = await this.getSnapshot<{ total: number; items: unknown[] }>(ownerId, "search_repos", key);
    if (cached) return cached;

    const now = Date.now();
    this.codeSearchHits = this.codeSearchHits.filter((t) => now - t < 60_000);
    if (this.codeSearchHits.length >= 9) {
      throw new Error("代码搜索限速 10 次/分钟（GitHub 硬限制），请一分钟后再试");
    }
    this.codeSearchHits.push(now);

    const token = await this.requireToken(ownerId);
    const res = await fetch(`${API}/search/code?q=${encodeURIComponent(query)}&per_page=10`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
      },
    });
    if (res.status === 403 || res.status === 429) throw new Error(`GitHub 代码搜索限流（${res.status}），稍后再试`);
    if (res.status === 422) throw new Error("代码搜索需要限定符，如「xxx user:@me」或「xxx repo:owner/name language:go」");
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const j: any = await res.json();
    const data = {
      total: j.total_count ?? 0,
      items: (j.items ?? []).map((it: any) => ({
        name: it.name,
        path: it.path,
        repo: it.repository?.full_name ?? "",
        url: it.html_url,
      })),
    };
    return this.putSnapshot(ownerId, "search_repos", key, data, 5 * 60 * 1000);
  }

  // ── AI 生成（判断与草稿，不落 GitHub） ──────────────────

  /** 单次 LLM 调用，失败返回 null（调用方回退模板） */
  private async llmOnce(system: string, user: string, timeoutMs = 30_000): Promise<string | null> {
    try {
      const realModels = await this.models.listRealModels();
      const model = realModels[0];
      if (!model) return null;
      const resp = await this.llm.chat({
        endpoint: model.endpoint,
        apiKey: model.apiKey,
        model: model.modelName,
        temperature: 0.3,
        timeoutMs,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      return resp.content?.trim() || null;
    } catch (e) {
      this.log.warn(`llmOnce 失败: ${(e as Error).message}`);
      return null;
    }
  }

  /** 仓库问答：meta + README + 近 15 commit 作上下文，本地 LLM 生成判断 */
  async ask(ownerId: string, owner: string, name: string, question: string) {
    const q = (question ?? "").trim();
    if (!q) throw new NotFoundException("question 不能为空");
    const [repo, readme, commits] = await Promise.all([
      this.repo(ownerId, owner, name),
      this.readme(ownerId, owner, name).catch(() => null),
      this.commits(ownerId, owner, name).catch(() => null),
    ]);
    const r = repo.data as Record<string, unknown>;
    const ctx = [
      `仓库: ${r.fullName} (${r.htmlUrl})`,
      `描述: ${r.description ?? "无"}`,
      `语言: ${r.language ?? "未知"} · ★${r.stars} · ⑂${r.forks} · issues ${r.openIssues} · pushed ${r.pushedAt}`,
      r.topics && (r.topics as string[]).length ? `topics: ${(r.topics as string[]).join(", ")}` : "",
      `README（截断）:\n${((readme?.data as { content?: string } | null)?.content ?? "无").slice(0, 4000)}`,
      `最近提交:\n${(((commits?.data as { message?: string }[] | null) ?? []).slice(0, 15).map((c) => `- ${String(c.message ?? "").split("\n")[0]}`).join("\n"))}`,
    ].filter(Boolean).join("\n\n");

    const answer = await this.llmOnce(
      "你是 GitHub 仓库分析器。根据给出的仓库快照回答用户问题。输出的是判断不是泛泛而谈：" +
        "不确定就直说数据不足；回答中文，不超过 200 字；涉及链接直接用快照里的 URL。",
      `仓库快照：\n${ctx}\n\n问题：${q}`,
      30_000,
    );
    return {
      answer: answer ?? "本地模型不可用，无法生成回答。可直接打开仓库查看：" + String(r.htmlUrl),
      repo: r.fullName,
      url: r.htmlUrl,
    };
  }

  /** review 草稿：PR meta + 文件补丁 → markdown。本地生成，用户复制去 GitHub 发，工作台不代发。 */
  async reviewDraft(ownerId: string, owner: string, name: string, prNumber: number) {
    if (!Number.isInteger(prNumber) || prNumber <= 0) throw new NotFoundException("pr 必须是正整数");
    const token = await this.requireToken(ownerId);
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
    };
    const [prRes, filesRes] = await Promise.all([
      fetch(`${API}/repos/${owner}/${name}/pulls/${prNumber}`, { headers }),
      fetch(`${API}/repos/${owner}/${name}/pulls/${prNumber}/files?per_page=30`, { headers }),
    ]);
    if (prRes.status === 404) throw new NotFoundException(`PR #${prNumber} 不存在`);
    if (!prRes.ok) throw new Error(`GitHub ${prRes.status}`);
    const pr: any = await prRes.json();
    const files: any = filesRes.ok ? await filesRes.json() : [];

    const fileList = (Array.isArray(files) ? files : []).slice(0, 20).map((f: any) => {
      const patch = typeof f.patch === "string" ? f.patch.split("\n").slice(0, 120).join("\n") : "(无二进制/过大补丁)";
      return `### ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})\n${patch}`;
    });
    const ctx = [
      `PR: ${pr.title} (#${pr.number}) by ${pr.user?.login}`,
      `仓库: ${owner}/${name} · 分支 ${pr.head?.ref} → ${pr.base?.ref}`,
      `描述:\n${(pr.body ?? "无").slice(0, 2000)}`,
      `变更: ${pr.changed_files} 个文件, +${pr.additions}/-${pr.deletions}`,
      `文件补丁（截断）:\n${fileList.join("\n\n")}`,
    ].join("\n\n");

    const md = await this.llmOnce(
      "你是代码评审助手。根据 PR 快照生成 review 草稿（markdown），结构：" +
        "## 总结（2-3 句判断这个 PR 在做什么、改得怎么样）\n## 主要变更（按文件/模块分组列点）\n## 风险与建议（测试缺失、兼容性、可疑改动；没有就说没有）\n" +
        "只基于给出的快照，不要臆测没看到的代码。中文输出。",
      ctx,
      45_000,
    );
    return {
      markdown:
        md ??
        `## 总结\nPR #${prNumber}「${pr.title}」改了 ${pr.changed_files} 个文件（+${pr.additions}/-${pr.deletions}）。本地模型不可用，请直接查看：${pr.html_url}`,
      prUrl: pr.html_url as string,
      title: pr.title as string,
      note: "草稿在本地生成，请人工核对后复制到 GitHub 发布；工作台不代发。",
    };
  }

  /** 热门新项目榜：GitHub 没有官方 trending API，用官方搜索代理——近 7 天创建、按 stars 排序。TTL 6h。 */
  async trending(ownerId: string, force = false) {
    const key = "trending::weekly";
    if (force) await this.invalidate(ownerId, "search_repos", key);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return this.fetchSnapshot(
      ownerId, "search_repos", key,
      `/search/repositories?q=${encodeURIComponent(`created:>${since}`)}&sort=stars&order=desc&per_page=5`,
      6 * 60 * 60 * 1000,
      (j: any) => ({
        since,
        items: (j.items ?? []).map((r: any) => ({
          fullName: r.full_name,
          description: r.description,
          stars: r.stargazers_count,
          language: r.language,
          createdAt: r.created_at,
          url: r.html_url,
        })),
      }),
    );
  }

  // ── 快照缓存工具 ────────────────────────────────────────

  private async getSnapshot<T>(ownerId: string, kind: SnapshotKind, key: string): Promise<Snapshot<T> | null> {
    const existing = await this.db.query.githubSnapshots.findFirst({
      where: and(eq(githubSnapshots.ownerId, ownerId), eq(githubSnapshots.kind, kind), eq(githubSnapshots.key, key)),
    });
    if (!existing) return null;
    const now = new Date();
    if (existing.expiresAt > now) {
      return { data: JSON.parse(existing.payload), fetchedAt: existing.fetchedAt, stale: false };
    }
    return null;
  }

  private async putSnapshot<T>(ownerId: string, kind: SnapshotKind, key: string, data: T, ttlMs: number): Promise<Snapshot<T>> {
    const fetchedAt = new Date();
    const payload = JSON.stringify(data);
    const existing = await this.db.query.githubSnapshots.findFirst({
      where: and(eq(githubSnapshots.ownerId, ownerId), eq(githubSnapshots.kind, kind), eq(githubSnapshots.key, key)),
    });
    if (existing) {
      await this.db
        .update(githubSnapshots)
        .set({ payload, etag: null, fetchedAt, expiresAt: new Date(fetchedAt.getTime() + ttlMs) })
        .where(eq(githubSnapshots.id, existing.id));
    } else {
      await this.db.insert(githubSnapshots).values({
        id: randomUUID(), ownerId, kind, key, payload, fetchedAt, expiresAt: new Date(fetchedAt.getTime() + ttlMs),
      });
    }
    return { data, fetchedAt, stale: false };
  }

  private async invalidate(ownerId: string, kind: SnapshotKind, key: string) {
    await this.db
      .update(githubSnapshots)
      .set({ expiresAt: new Date(0) })
      .where(and(eq(githubSnapshots.ownerId, ownerId), eq(githubSnapshots.kind, kind), eq(githubSnapshots.key, key)));
  }

  private maskToken(token: string): string {
    if (token.length <= 8) return "••••";
    return `${token.slice(0, 4)}••••${token.slice(-4)}`;
  }
}
