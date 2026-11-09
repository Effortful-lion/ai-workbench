import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  BlogCommentDto, BlogCommentPageDto, BlogCommentStatus, BlogModerationItemDto, BlogPostDto,
  BlogPublicPostDetailDto, BlogPublicPostDto,
} from "@aiwb/shared";
import { api } from "../../lib/api";
import { Icon } from "../../lib/icons";
import { usePanelStore } from "../../stores/panel";
import BlogCardWall from "./BlogCardWall";
import BlogReader from "./BlogReader";
import { CATEGORY_META, formatDate, formatDateTime } from "./blogUtils";

type Tab = "posts" | "moderation";

const STATUS_META: Record<BlogCommentStatus, { label: string; cls: string }> = {
  pending: { label: "待审核", cls: "border-warn/50 text-warn" },
  approved: { label: "已通过", cls: "border-acc/50 text-acc" },
  rejected: { label: "已拒绝", cls: "border-err/50 text-err" },
  hidden: { label: "已隐藏", cls: "border-line text-tx3" },
};

/**
 * 博客面板：文章只读（发布/下架在 KB），评论审核在此（评论属于博客自身职责）。
 */
export default function BlogPanel() {
  const openPanel = usePanelStore((s) => s.openPanel);
  const [tab, setTab] = useState<Tab>("posts");

  const [posts, setPosts] = useState<BlogPostDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [comments, setComments] = useState<BlogCommentDto[]>([]);

  const [queue, setQueue] = useState<BlogModerationItemDto[] | null>(null);
  const [filter, setFilter] = useState<BlogCommentStatus | "all">("pending");
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setPosts(await api<BlogPostDto[]>("/blog/posts"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const reloadQueue = useCallback(async (st: BlogCommentStatus | "all") => {
    try {
      setQueue(await api<BlogModerationItemDto[]>(`/blog/moderation/comments?status=${st === "all" ? "" : st}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setQueue([]);
    }
  }, []);

  useEffect(() => {
    void reload();
    void reloadQueue("pending");
  }, [reload, reloadQueue]);

  // 阅读某篇：正文评论（只展示已通过）
  useEffect(() => {
    if (!openId) return;
    let alive = true;
    setComments([]);
    api<BlogCommentDto[]>(`/blog/posts/${openId}/comments`)
      .then((d) => alive && setComments(d))
      .catch(() => alive && setComments([]));
    return () => {
      alive = false;
    };
  }, [openId]);

  const cards = useMemo<BlogPublicPostDto[]>(
    () =>
      (posts ?? []).map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        summary: p.summary,
        category: p.category,
        tags: p.tags,
        publishedAt: p.publishedAt ?? p.createdAt,
        commentCount: p.commentCount,
        charCount: p.contentMd.length,
      })),
    [posts],
  );

  /** 面板阅读用：把扁平评论按 rootId 组装成树（只含已通过） */
  const commentPage = useMemo<BlogCommentPageDto>(() => {
    const approved = comments.filter((c) => c.status === "approved");
    const roots = approved
      .filter((c) => c.depth === 0)
      .sort((a, b) => b.createdAt - a.createdAt);
    const grouped = new Map<string, BlogCommentDto[]>();
    approved
      .filter((c) => c.depth === 1)
      .sort((a, b) => a.createdAt - b.createdAt)
      .forEach((c) => {
        const list = grouped.get(c.rootId) ?? [];
        list.push(c);
        grouped.set(c.rootId, list);
      });
    return {
      threads: roots.map((r) => ({ root: r, children: grouped.get(r.id) ?? [] })),
      total: roots.length,
      page: 1,
      pageSize: Math.max(10, roots.length),
    };
  }, [comments]);

  const detail = useMemo<BlogPublicPostDetailDto | null>(() => {
    if (!posts || !openId) return null;
    const ordered = posts.slice().sort((a, b) => (b.publishedAt ?? b.createdAt) - (a.publishedAt ?? a.createdAt));
    const ix = ordered.findIndex((p) => p.id === openId);
    if (ix < 0) return null;
    const p = ordered[ix];
    const neighbor = (q?: BlogPostDto) => (q ? { slug: q.slug, title: q.title } : null);
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      summary: p.summary,
      category: p.category,
      tags: p.tags,
      publishedAt: p.publishedAt ?? p.createdAt,
      commentCount: p.commentCount,
      charCount: p.contentMd.length,
      contentMd: p.contentMd,
      prev: neighbor(ordered[ix - 1]),
      next: neighbor(ordered[ix + 1]),
    };
  }, [posts, openId]);

  const pendingCount = queue?.filter((q) => q.comment.status === "pending").length ?? 0;

  const review = async (item: BlogModerationItemDto, status: BlogCommentStatus) => {
    setBusyId(item.comment.id);
    try {
      await api(`/blog/comments/${item.comment.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, note: status === "rejected" ? "不符合评论规范" : undefined }),
      });
      await reloadQueue(filter);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  if (openId && detail) {
    return (
      <BlogReader
        embedded
        readOnlyComments
        post={detail}
        comments={commentPage}
        onBack={() => setOpenId(null)}
        onNavigate={(s) => {
          const hit = posts?.find((p) => p.slug === s);
          if (hit) setOpenId(hit.id);
        }}
      />
    );
  }

  return (
    <div className="mx-auto w-[min(1100px,97%)] py-4 font-mono">
      {/* 顶部：只读说明 + 入口 */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10.5px]">
        <span className="flex items-center gap-1.5 text-acc">
          <Icon name="newspaper" size={12} />
          博客
        </span>
        <span className="text-tx3">// 文章内容与发布/下架在知识库完成；评论审核在此</span>
        <button
          className="ml-auto flex items-center gap-1.5 rounded border border-acc/40 px-2 py-0.5 text-acc transition-colors hover:border-acc hover:bg-acc/10"
          onClick={() => openPanel("kb")}
        >
          <Icon name="doc" size={11} />
          去知识库
        </button>
      </div>

      {/* Tab：文章 / 评论审核 */}
      <div className="mb-3 flex items-center gap-1 border-b border-line text-[11px]">
        <button
          className={`-mb-px flex items-center gap-1.5 border-b px-3 py-1.5 transition-colors ${
            tab === "posts" ? "border-acc text-acc" : "border-transparent text-tx3 hover:text-tx2"
          }`}
          onClick={() => setTab("posts")}
        >
          <Icon name="blog" size={12} />
          文章
        </button>
        <button
          className={`-mb-px flex items-center gap-1.5 border-b px-3 py-1.5 transition-colors ${
            tab === "moderation" ? "border-acc text-acc" : "border-transparent text-tx3 hover:text-tx2"
          }`}
          onClick={() => {
            setTab("moderation");
            void reloadQueue(filter);
          }}
        >
          <Icon name="comment" size={12} />
          评论审核
          {pendingCount > 0 && (
            <span className="rounded bg-warn/15 px-1 text-[9.5px] text-warn">{pendingCount}</span>
          )}
        </button>
      </div>

      {error && <div className="mb-2 rounded border border-err/40 bg-err/5 px-3 py-1.5 text-[11px] text-err">✗ {error}</div>}

      {tab === "posts" ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-tx3">
            <span>
              已发布 {(posts ?? []).filter((p) => p.status === "published").length} ·
              已下架 {(posts ?? []).filter((p) => p.status === "archived").length} ·
              合计 {(posts ?? []).length}
            </span>
            <span className="flex items-center gap-1">
              <Icon name="clock" size={10} />
              最近更新 {posts && posts.length > 0 ? formatDate(Math.max(...posts.map((p) => p.updatedAt))) : "—"}
            </span>
          </div>

          {!posts ? (
            <div className="flex h-[140px] items-center justify-center text-[12px] text-tx3">⠋ 读取文章…</div>
          ) : posts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded border border-dashed border-line py-14 text-[11px] text-tx3">
              <Icon name="write" size={18} />
              <span>// 还没有博客文章</span>
              <span>在知识库中书写或上传文档，然后对文档行点「发布」</span>
            </div>
          ) : (
            <div className="grid-bg rounded border border-line bg-bg p-3">
              <BlogCardWall
                posts={cards}
                onOpen={(slug) => {
                  const hit = posts.find((p) => p.slug === slug);
                  if (hit) setOpenId(hit.id);
                }}
                emptyText="// 暂无文章"
              />
            </div>
          )}

          {posts && posts.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[9.5px] text-tx3">
              <span className="flex items-center gap-1">
                <Icon name="tag" size={10} />
                {Object.values(CATEGORY_META).map((c) => c.label).join(" ")}
              </span>
              <span className="ml-auto">// 文章面板只读</span>
            </div>
          )}
        </>
      ) : (
        <>
          {/* 审核筛选 */}
          <div className="mb-3 flex flex-wrap items-center gap-1 text-[10.5px]">
            {(["pending", "approved", "rejected", "hidden", "all"] as const).map((s) => (
              <button
                key={s}
                className={`rounded px-2 py-0.5 transition-colors ${
                  s === filter ? "bg-acc/10 text-acc" : "text-tx3 hover:text-acc"
                }`}
                onClick={() => {
                  setFilter(s);
                  void reloadQueue(s);
                }}
              >
                {s === "all" ? "全部" : STATUS_META[s].label}
              </button>
            ))}
            <span className="ml-2 text-tx3">
              {queue === null ? "⠋ 读取中" : `${queue.length} 条`}
            </span>
            <span className="ml-auto text-[9.5px] text-tx3">
              // 命中敏感词/过多链接自动待审；博主本人评论直接通过
            </span>
          </div>

          {queue === null ? (
            <div className="flex h-[120px] items-center justify-center text-[12px] text-tx3">⠋ 读取审核队列…</div>
          ) : queue.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded border border-dashed border-line py-12 text-[11px] text-tx3">
              <Icon name="comment" size={16} />
              <span>// 没有{filter === "all" ? "" : STATUS_META[filter as BlogCommentStatus].label}评论</span>
            </div>
          ) : (
            <div className="overflow-hidden rounded border border-line bg-bg1">
              {queue.map((q) => (
                <div key={q.comment.id} className="border-b border-line px-4 py-3 last:border-b-0">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-tx3">
                    <span className={`rounded border px-1.5 py-0.5 text-[9.5px] ${STATUS_META[q.comment.status].cls}`}>
                      {STATUS_META[q.comment.status].label}
                    </span>
                    <span className="text-[11px] text-tx2">{q.comment.nickname}</span>
                    <span>{formatDateTime(q.comment.createdAt)}</span>
                    <span className="truncate">·《{q.postTitle}》</span>
                    {q.comment.replyToUsername && (
                      <span>· 回复 @{q.comment.replyToUsername}</span>
                    )}
                  </div>
                  <div className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-tx2">
                    {q.comment.content}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px]">
                    {q.comment.status !== "approved" && (
                      <button
                        className="flex items-center gap-1 rounded border border-acc/50 px-2 py-0.5 text-acc transition-colors hover:bg-acc/10 disabled:opacity-50"
                        disabled={busyId === q.comment.id}
                        onClick={() => void review(q, "approved")}
                      >
                        <Icon name="publish" size={10} /> 通过
                      </button>
                    )}
                    {q.comment.status !== "rejected" && (
                      <button
                        className="flex items-center gap-1 rounded border border-err/40 px-2 py-0.5 text-err transition-colors hover:bg-err/10 disabled:opacity-50"
                        disabled={busyId === q.comment.id}
                        onClick={() => void review(q, "rejected")}
                      >
                        <Icon name="trash" size={10} /> 拒绝
                      </button>
                    )}
                    {q.comment.status === "approved" && (
                      <button
                        className="rounded border border-line px-2 py-0.5 text-tx3 transition-colors hover:text-warn disabled:opacity-50"
                        disabled={busyId === q.comment.id}
                        onClick={() => void review(q, "hidden")}
                      >
                        隐藏
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
