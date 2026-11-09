import { useCallback, useEffect, useMemo, useState } from "react";
import type { BlogCommentDto, BlogPostDto, BlogPublicPostDetailDto, BlogPublicPostDto } from "@aiwb/shared";
import { api } from "../../lib/api";
import { Icon } from "../../lib/icons";
import { usePanelStore } from "../../stores/panel";
import BlogCardWall from "./BlogCardWall";
import BlogReader from "./BlogReader";
import { CATEGORY_META, formatDate } from "./blogUtils";

/**
 * 博客面板（只读）：列表 + 阅读 + 评论线程。
 * 发布/下架/上架/移除全部在 KB 文档行完成；面板内不出现任何写操作按钮。
 */
export default function BlogPanel() {
  const openPanel = usePanelStore((s) => s.openPanel);
  const [posts, setPosts] = useState<BlogPostDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [comments, setComments] = useState<BlogCommentDto[]>([]);

  const reload = useCallback(async () => {
    try {
      setPosts(await api<BlogPostDto[]>("/blog/posts"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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

  /** 卡片列表形态：只读面板复用卡片墙，仅保留 published 之外的视觉区分 */
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

  /** 阅读：由面板列表数据组装详情（含上下篇），草稿/下架也可读 */
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

  const statusLine = useMemo(() => {
    const list = posts ?? [];
    const pub = list.filter((p) => p.status === "published").length;
    const arch = list.filter((p) => p.status === "archived").length;
    return `已发布 ${pub} · 已下架 ${arch} · 合计 ${list.length}`;
  }, [posts]);

  if (openId && detail) {
    return (
      <BlogReader
        embedded
        readOnlyComments
        post={detail}
        comments={comments}
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
      {/* 顶部：只读说明 + 唯一入口指向 KB */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10.5px]">
        <span className="flex items-center gap-1.5 text-acc">
          <Icon name="newspaper" size={12} />
          博客（只读）
        </span>
        <span className="text-tx3">
          // 文章内容与发布/下架均在知识库完成：KB 文档行 → 发布到博客
        </span>
        <button
          className="ml-auto flex items-center gap-1.5 rounded border border-acc/40 px-2 py-0.5 text-acc transition-colors hover:border-acc hover:bg-acc/10"
          onClick={() => openPanel("kb")}
        >
          <Icon name="doc" size={11} />
          去知识库
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-tx3">
        <span>{statusLine}</span>
        <span className="flex items-center gap-1">
          <Icon name="clock" size={10} />
          最近更新 {posts && posts.length > 0 ? formatDate(Math.max(...posts.map((p) => p.updatedAt))) : "—"}
        </span>
      </div>

      {error && <div className="mb-2 rounded border border-err/40 bg-err/5 px-3 py-1.5 text-[11px] text-err">✗ {error}</div>}

      {!posts ? (
        <div className="flex h-[140px] items-center justify-center text-[12px] text-tx3">⠋ 读取文章…</div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded border border-dashed border-line py-14 text-[11px] text-tx3">
          <Icon name="write" size={18} />
          <span>// 还没有博客文章</span>
          <span className="text-tx3">在知识库中书写或上传文档，然后对文档行点「发布到博客」</span>
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
          <span className="ml-auto">// 面板只读 · 评论在公开页产生 · 完整审核设计后续提供</span>
        </div>
      )}
    </div>
  );
}
