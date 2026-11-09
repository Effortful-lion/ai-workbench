import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BlogCommentDto, BlogPublicPostDetailDto, BlogPublicPostDto } from "@aiwb/shared";
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
  const [comments, setComments] = useState<BlogCommentDto[]>([]);

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

  // 正文 + 评论
  useEffect(() => {
    if (!openSlug) return;
    let alive = true;
    setPost(null);
    setPostError(null);
    setComments([]);
    fetch(postUrl(openSlug))
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? `HTTP ${r.status}`);
        return (await r.json()) as BlogPublicPostDetailDto;
      })
      .then((d) => alive && setPost(d))
      .catch((e) => alive && setPostError(e instanceof Error ? e.message : String(e)));
    fetch(`${postUrl(openSlug)}/comments`)
      .then(async (r) => (r.ok ? ((await r.json()) as BlogCommentDto[]) : []))
      .then((d) => alive && setComments(d))
      .catch(() => alive && setComments([]));
    return () => {
      alive = false;
    };
  }, [openSlug]);

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

  const submitComment = async (input: { content: string }) => {
    if (!openSlug) return;
    // 评论发表需登录：api() 自动带 token 并处理 401 续期
    const c = await api<BlogCommentDto>(
      `/blog/public/${encodeURIComponent(username)}/${encodeURIComponent(openSlug)}/comments`,
      { method: "POST", body: JSON.stringify(input) },
    );
    setComments((prev) => [c, ...prev]);
    setPost((p) => (p ? { ...p, commentCount: p.commentCount + 1 } : p));
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
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
