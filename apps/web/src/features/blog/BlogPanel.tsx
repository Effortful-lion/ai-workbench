import { useCallback, useEffect, useState } from "react";
import type { BlogCommentDto, BlogPostDto } from "@aiwb/shared";
import { api } from "../../lib/api";
import { useAuthStore } from "../../stores/auth";
import { useConfirmStore } from "../../stores/confirm";
import { usePanelStore } from "../../stores/panel";
import { MarkdownText } from "../../lib/markdown";

const CAT_LABEL: Record<string, string> = {
  kb: "#知识库",
  agent: "#Agent",
  pipe: "#管道",
  essay: "#随笔",
};
const STATUS_META: Record<string, { label: string; cls: string }> = {
  published: { label: "● 已发布", cls: "text-acc" },
  draft: { label: "○ 草稿", cls: "text-tx3" },
  archived: { label: "◌ 已下架", cls: "text-warn" },
};

/** 博客管理面板：内容生产在 KB（发布动作在 KB 文档行），这里只管展示层——分类/状态/评论 */
export default function BlogPanel() {
  const user = useAuthStore((s) => s.user);
  const canWrite = user?.role === "owner" || user?.role === "member";
  const openPanel = usePanelStore((s) => s.openPanel);
  const [posts, setPosts] = useState<BlogPostDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState<string>("#全部");
  /** 展开的文章：正文预览 + 评论管理 */
  const [openId, setOpenId] = useState<string | null>(null);
  const [comments, setComments] = useState<BlogCommentDto[] | null>(null);

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

  const loadComments = useCallback(async (postId: string) => {
    setComments(null);
    try {
      setComments(await api<BlogCommentDto[]>(`/blog/posts/${postId}/comments`));
    } catch (e) {
      setComments([]);
      setNotice(`评论加载失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const toggleOpen = (p: BlogPostDto) => {
    if (openId === p.id) {
      setOpenId(null);
      setComments(null);
    } else {
      setOpenId(p.id);
      void loadComments(p.id);
    }
  };

  const setStatus = async (p: BlogPostDto, status: "published" | "draft" | "archived") => {
    try {
      await api(`/blog/posts/${p.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setNotice(status === "published" ? `✓ 《${p.title}》已发布` : `✓ 《${p.title}》已${status === "draft" ? "转草稿" : "下架"}`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removePost = (p: BlogPostDto) => {
    useConfirmStore.getState().ask({
      title: "删除文章",
      message: `《${p.title}》将从博客移除（KB 文档与向量不受影响），评论一并删除。`,
      confirmText: "⏎ 确认删除",
      danger: true,
      onConfirm: () => {
        void api(`/blog/posts/${p.id}`, { method: "DELETE" }).then(() => {
          setNotice(`✓ 《${p.title}》已删除`);
          return reload();
        });
      },
    });
  };

  const setCommentStatus = async (c: BlogCommentDto, status: "approved" | "hidden") => {
    await api(`/blog/comments/${c.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    if (openId) void loadComments(openId);
    await reload();
  };

  const removeComment = (c: BlogCommentDto) => {
    useConfirmStore.getState().ask({
      title: "删除评论",
      message: `删除「${c.nickname}」的评论？`,
      confirmText: "⏎ 确认删除",
      danger: true,
      onConfirm: () => {
        void api(`/blog/comments/${c.id}`, { method: "DELETE" }).then(() => {
          if (openId) void loadComments(openId);
          return reload();
        });
      },
    });
  };

  const cats = ["#全部", "#知识库", "#Agent", "#管道", "#随笔"];
  const catOf = (label: string) =>
    label === "#全部" ? null : Object.entries(CAT_LABEL).find(([, l]) => l === label)?.[0];
  const shown = (posts ?? []).filter((p) => {
    const c = catOf(catFilter);
    return !c || p.category === c;
  });
  const openPost = posts?.find((p) => p.id === openId) ?? null;

  return (
    <div className="mx-auto w-[min(1100px,97%)] py-4 font-mono">
      {/* 头部：引导去 KB 创作 */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-acc">▸ 博客管理</span>
        <span className="text-tx3">// 内容在 KB 中书写或上传 → KB 文档行「▤ 发布到博客」；此处管理展示层</span>
        <button
          className="ml-auto rounded border border-acc/40 px-2 py-0.5 text-[10px] text-acc hover:border-acc hover:bg-acc/10"
          onClick={() => openPanel("kb")}
          title="打开 AI 知识库"
        >
          ▸ 去知识库写 / 发布
        </button>
      </div>

      {/* 分类筛选 + 计数 */}
      <div className="mb-3 flex flex-wrap items-center gap-1 text-[10.5px]">
        {cats.map((c) => (
          <button
            key={c}
            className={`rounded px-2 py-0.5 ${c === catFilter ? "bg-acc/10 text-acc" : "text-tx3 hover:text-acc"}`}
            onClick={() => setCatFilter(c)}
          >
            {c}
          </button>
        ))}
        <span className="ml-2 text-tx3">{catFilter} · {shown.length} 篇</span>
      </div>

      {notice && <div className="mb-2 rounded border border-acc/40 bg-acc/5 px-3 py-1.5 text-[11px] text-acc">{notice}</div>}
      {error && <div className="mb-2 rounded border border-err/40 bg-err/5 px-3 py-1.5 text-[11px] text-err">✗ {error}</div>}

      {/* 文章列表（台账行） */}
      <div className="overflow-hidden rounded-lg border border-line bg-bg1">
        {!posts ? (
          <div className="flex h-[140px] items-center justify-center text-[12px] text-tx3">⠋ 读取文章…</div>
        ) : shown.length === 0 ? (
          <div className="px-4 py-10 text-center text-[11px] text-tx3">
            // {catFilter === "#全部" ? "还没有文章：去知识库对文档点「▤ 发布到博客」" : "该分类下暂无文章"}
          </div>
        ) : (
          shown.map((p) => (
            <div key={p.id} className="border-b border-line last:border-b-0">
              <div className="flex min-h-[46px] cursor-pointer items-center gap-3 px-4 py-2 hover:bg-white/[0.02]" onClick={() => toggleOpen(p)}>
                <span className={`flex-none text-[10px] ${STATUS_META[p.status].cls}`}>{STATUS_META[p.status].label}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-tx">{p.title}</span>
                <span className="flex-none text-[10px] text-acc/75">{CAT_LABEL[p.category]}</span>
                <span className="hidden flex-none text-[10px] text-tx3 sm:inline">💬 {p.commentCount}</span>
                <span className="hidden flex-none text-[10px] text-tx3 md:inline">
                  {p.publishedAt ? new Date(p.publishedAt).toISOString().slice(0, 10) : "—"}
                </span>
                {canWrite && (
                  <span className="flex flex-none items-center gap-2 text-[10px]">
                    {p.status !== "published" && (
                      <button className="text-tx3 hover:text-acc" onClick={(e) => { e.stopPropagation(); void setStatus(p, "published"); }} title="发布">▲ 发布</button>
                    )}
                    {p.status === "published" && (
                      <button className="text-tx3 hover:text-warn" onClick={(e) => { e.stopPropagation(); void setStatus(p, "archived"); }} title="下架（公开页不再可见）">▼ 下架</button>
                    )}
                    <button className="text-tx3 hover:text-err" onClick={(e) => { e.stopPropagation(); removePost(p); }} title="删除">✗</button>
                  </span>
                )}
                <span className="flex-none text-[9px] text-tx3">{openId === p.id ? "▾" : "▸"}</span>
              </div>
              {/* 展开区：正文预览 + 公开地址 + 评论管理 */}
              {openId === p.id && openPost && (
                <div className="border-t border-dashed border-line px-4 py-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-tx3">
                    <span>slug: <span className="text-tx2">{openPost.slug}</span></span>
                    <span>· 公开地址 /b/{user?.username}/{openPost.slug}</span>
                    {openPost.tags.length > 0 && <span>· {openPost.tags.join(" ")}</span>}
                  </div>
                  <div className="mb-3 max-h-[240px] overflow-y-auto rounded border border-line bg-bg px-3 py-2 text-[12px] [&_p]:my-1.5">
                    <MarkdownText text={openPost.contentMd.slice(0, 2000)} />
                  </div>
                  <div className="text-[10.5px] text-tx2">// 评论 · {comments === null ? "⠋ 读取中" : (comments.length || "暂无")}</div>
                  {comments?.map((c) => (
                    <div key={c.id} className="mt-2 flex items-start gap-2 rounded border border-line px-3 py-2 text-[11px]">
                      <span className="text-acc">{c.nickname}</span>
                      <span className="text-tx3">{new Date(c.createdAt).toLocaleString()}</span>
                      {c.status === "hidden" && <span className="text-warn">· 已隐藏</span>}
                      <span className="min-w-0 flex-1 break-words text-tx2">{c.content}</span>
                      {canWrite && (
                        <span className="flex flex-none gap-2">
                          {c.status === "approved" ? (
                            <button className="text-tx3 hover:text-warn" onClick={() => void setCommentStatus(c, "hidden")} title="隐藏（公开页不可见）">◐ 隐藏</button>
                          ) : (
                            <button className="text-tx3 hover:text-acc" onClick={() => void setCommentStatus(c, "approved")} title="恢复显示">◑ 恢复</button>
                          )}
                          <button className="text-tx3 hover:text-err" onClick={() => removeComment(c)} title="删除">✗</button>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
