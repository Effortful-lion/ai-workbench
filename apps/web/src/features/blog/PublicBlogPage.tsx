import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  BlogCommentDto, BlogCommentPageDto, BlogModerationItemDto, BlogPublicPostDetailDto, BlogPublicPostDto,
} from "@aiwb/shared";
import { api } from "../../lib/api";
import { Icon } from "../../lib/icons";
import { useAuthStore } from "../../stores/auth";
import PublicBackLink from "../public/PublicBackLink";
import BlogCardWall from "./BlogCardWall";
import BlogReader from "./BlogReader";

/** 游客公开博客：/b/:username（卡片墙）↔ /b/:username/:slug（FLIP 铺满的独立阅读页） */
export default function PublicBlogPage({ username, slug }: { username: string; slug?: string }) {
  const viewer = useAuthStore((s) => s.user);
  const [posts, setPosts] = useState<BlogPublicPostDto[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(slug ?? null);
  const [post, setPost] = useState<BlogPublicPostDetailDto | null>(null);
  const [postError, setPostError] = useState<string | null>(null);
  const [comments, setComments] = useState<BlogCommentPageDto | null>(null);
  const [commentsPage, setCommentsPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  /** 博主视角：待审评论数（公开页看不到待审评论，需要入口告知） */
  const [pendingCount, setPendingCount] = useState(0);

  const isOwner = !!viewer && viewer.username === username;

  const panelRef = useRef<HTMLDivElement>(null);
  const jumpFrom = useRef<DOMRect | null>(null);

  const listUrl = `/api/blog/public/${encodeURIComponent(username)}`;
  const postUrl = (s: string) => `${listUrl}/${encodeURIComponent(s)}`;

  // 列表
  useEffect(() => {
    fetch(listUrl)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? `HTTP ${r.status}`);
        return (await r.json()) as BlogPublicPostDto[];
      })
      .then(setPosts)
      .catch((e) => setListError(e instanceof Error ? e.message : String(e)));
  }, [listUrl]);

  /** 拉取评论：page=1 覆盖，>1 追加（一级分页 + 子评论批量由服务端组装） */
  const loadComments = useCallback(
    async (targetSlug: string, page: number, append: boolean) => {
      const r = await fetch(`${postUrl(targetSlug)}/comments?page=${page}&pageSize=10`);
      if (!r.ok) return;
      const d = (await r.json()) as BlogCommentPageDto;
      setComments((prev) => {
        if (!append || !prev) return d;
        const seen = new Set(prev.threads.map((t) => t.root.id));
        return {
          ...d,
          threads: [...prev.threads, ...d.threads.filter((t) => !seen.has(t.root.id))],
        };
      });
    },
    [listUrl],
  );

  // 正文 + 评论
  useEffect(() => {
    if (!openSlug) return;
    let alive = true;
    setPost(null);
    setPostError(null);
    setComments(null);
    setCommentsPage(1);
    fetch(postUrl(openSlug))
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? `HTTP ${r.status}`);
        return (await r.json()) as BlogPublicPostDetailDto;
      })
      .then((d) => alive && setPost(d))
      .catch((e) => alive && setPostError(e instanceof Error ? e.message : String(e)));
    void loadComments(openSlug, 1, false);
    return () => {
      alive = false;
    };
  }, [openSlug, loadComments]);

  /** 加载更多一级评论 */
  const loadMoreComments = useCallback(async () => {
    if (!openSlug || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = commentsPage + 1;
      await loadComments(openSlug, next, true);
      setCommentsPage(next);
    } finally {
      setLoadingMore(false);
    }
  }, [openSlug, commentsPage, loadingMore, loadComments]);

  // 博主本人浏览自己的公开博客：拉待审计数（未登录/无权限静默忽略）
  useEffect(() => {
    if (!isOwner) return;
    let alive = true;
    api<BlogModerationItemDto[]>("/blog/moderation/comments?status=pending")
      .then((d) => alive && setPendingCount(d.length))
      .catch(() => alive && setPendingCount(0));
    return () => {
      alive = false;
    };
  }, [isOwner, openSlug]);

  // FLIP：卡片矩形 → 全屏（450ms）
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !openSlug) return;
    const from = jumpFrom.current;
    jumpFrom.current = null;
    if (!from) {
      panel.style.cssText = "";
      return;
    }
    panel.style.transition = "none";
    panel.style.position = "fixed";
    panel.style.left = `${from.left}px`;
    panel.style.top = `${from.top}px`;
    panel.style.width = `${from.width}px`;
    panel.style.height = `${from.height}px`;
    panel.style.opacity = "0.75";
    requestAnimationFrame(() => {
      panel.style.transition =
        "left .45s cubic-bezier(.2,.8,.2,1), top .45s cubic-bezier(.2,.8,.2,1), width .45s cubic-bezier(.2,.8,.2,1), height .45s cubic-bezier(.2,.8,.2,1), opacity .25s";
      panel.style.left = "0";
      panel.style.top = "0";
      panel.style.width = "100%";
      panel.style.height = "100%";
      panel.style.opacity = "1";
    });
  }, [openSlug]);

  const close = useCallback(() => {
    // 由站内 pushState 打开 → 回退到列表；直接命中 URL 打开 → 替换为列表地址
    if (window.history.state?.blog) {
      window.history.back();
    } else {
      window.history.replaceState(null, "", `/b/${encodeURIComponent(username)}`);
      setOpenSlug(null);
    }
  }, [username]);

  // 浏览器返回 / 前进
  useEffect(() => {
    const onPop = () => {
      const m = window.location.pathname.match(/^\/b\/([^/]+)\/([^/]+)\/?$/);
      setOpenSlug(m ? decodeURIComponent(m[2]) : null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Esc 返回
  useEffect(() => {
    if (!openSlug) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSlug, close]);

  const open = (s: string, el?: HTMLElement) => {
    jumpFrom.current = el?.getBoundingClientRect() ?? null;
    setOpenSlug(s);
    window.history.pushState({ blog: s }, "", `/b/${encodeURIComponent(username)}/${encodeURIComponent(s)}`);
  };

  const submitComment = async (input: { content: string; parentId?: string | null }) => {
    if (!openSlug) throw new Error("文章未打开");
    // 评论发表需登录：api() 自动带 token 并处理 401 续期
    const c = await api<BlogCommentDto>(
      `/blog/public/${encodeURIComponent(username)}/${encodeURIComponent(openSlug)}/comments`,
      { method: "POST", body: JSON.stringify(input) },
    );
    // 待审评论不直接上屏；通过审核的重新拉第一页保证顺序与楼层正确
    if (c.status === "approved") {
      await loadComments(openSlug, 1, false);
      setCommentsPage(1);
      setPost((p) => (p ? { ...p, commentCount: p.commentCount + 1 } : p));
    }
    return c;
  };

  return (
    <div className="grid-bg min-h-full font-mono">
      {/* 列表页头 */}
      <div className="mx-auto w-full max-w-[1100px] px-5 pt-8">
        <div className="flex items-center justify-between text-[11px] text-tx3">
          <span className="min-w-0 truncate">
            <span className="text-acc">▸</span> AI-WORKBENCH · blog / {username}
          </span>
          <PublicBackLink />
        </div>
        <h1 className="mt-4 text-[15px] tracking-[0.14em] text-tx">一墙图纸卡片</h1>
        <p className="mt-2 max-w-[720px] text-[11.5px] leading-relaxed text-tx2">
          每篇文章是一张贴在方格纸上的图纸：编号、标题、摘要、分类、字数刻度一目了然。悬停只有 2px
          上浮与裁切角标点亮；点击卡片原位铺开为深度阅读页。
        </p>
      </div>

      <div className="mx-auto w-full max-w-[1100px] px-5 pb-16 pt-5">
        <ModerationNotice count={pendingCount} />
        {listError && <div className="py-10 text-[12px] text-err">✗ {listError}</div>}
        {!posts && !listError && <div className="py-16 text-center text-[12px] text-tx3">⠋ 读取博客…</div>}
        {posts && (
          <BlogCardWall
            posts={posts}
            activeSlug={openSlug ?? undefined}
            onOpen={open}
            emptyText={`// ${username} 还没有发布文章`}
          />
        )}
        <div className="mt-8 flex items-center gap-2 text-[10px] text-tx3">
          <Icon name="blog" size={11} />
          public read-only · 评论无需登录 · /b/{username}
        </div>
      </div>

      {/* 阅读层：fixed 铺满，FLIP 从卡片长出来 */}
      {openSlug && (
        <div className="fixed inset-0 z-50 bg-bg">
          <div ref={panelRef} className="h-full w-full overflow-hidden bg-bg">
            {postError ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-[12px] text-err">
                <span>✗ {postError}</span>
                <button
                  className="flex items-center gap-1.5 rounded border border-line px-3 py-1 text-tx2 hover:border-acc hover:text-acc"
                  onClick={close}
                >
                  <Icon name="back" size={12} /> 返回博客
                </button>
              </div>
            ) : !post ? (
              <div className="flex h-full items-center justify-center text-[12px] text-tx3">⠋ 读取文章…</div>
            ) : (
              <BlogReader
                post={post}
                comments={comments}
                author={viewer?.username ?? null}
                onBack={close}
                onNavigate={(s) => open(s)}
                onSubmitComment={submitComment}
                onLoadMoreComments={() => void loadMoreComments()}
                loadingMoreComments={loadingMore}
                commentsNotice={<ModerationNotice count={pendingCount} />}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 博主视角入口：公开页看不到待审评论，需显式告知数量并给出审核台入口 */
function ModerationNotice({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div className="mx-auto mb-3 flex w-full max-w-[680px] flex-wrap items-center gap-2 px-5 text-[11px]">
      <span className="flex flex-1 flex-wrap items-center gap-2 rounded border border-warn/40 bg-warn/5 px-3 py-2 text-warn">
        <Icon name="clock" size={12} />
        <span>{count} 条评论待审核 · 公开页不可见</span>
        <button
          className="ml-auto flex items-center gap-1 rounded border border-warn/50 px-2 py-0.5 text-[10.5px] transition-colors hover:bg-warn/10"
          onClick={() => window.location.assign("/?tab=moderation#/p=blog")}
        >
          去审核
          <Icon name="next" size={11} />
        </button>
      </span>
    </div>
  );
}
