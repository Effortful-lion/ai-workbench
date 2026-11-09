import { useEffect, useMemo, useRef, useState } from "react";
import type { BlogCommentDto, BlogCommentPageDto, BlogPublicPostDetailDto } from "@aiwb/shared";
import { Icon } from "../../lib/icons";
import BlogMarkdown from "./BlogMarkdown";
import CommentThread from "./CommentThread";
import { CATEGORY_META, formatDate, parseHeadings, readMinutes } from "./blogUtils";

interface Props {
  post: BlogPublicPostDetailDto;
  comments: BlogCommentPageDto | null;
  onBack: () => void;
  onNavigate: (slug: string) => void;
  onSubmitComment?: (input: { content: string; parentId?: string | null }) => Promise<BlogCommentDto>;
  onLoadMoreComments?: () => void;
  loadingMoreComments?: boolean;
  /** 当前登录用户名：null/undefined = 未登录（评论区显示登录引导） */
  author?: string | null;
  readOnlyComments?: boolean;
  embedded?: boolean;
}

/** 深度阅读页：顶栏 + 左目录 scrollspy + 680px 版心 + 上下篇 + 评论区 */
export default function BlogReader({
  post, comments, onBack, onNavigate, onSubmitComment, onLoadMoreComments,
  loadingMoreComments, author, readOnlyComments, embedded,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headings = useMemo(() => parseHeadings(post.contentMd), [post.contentMd]);
  const [active, setActive] = useState(-1);

  // 切篇回到顶部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [post.id]);

  // scrollspy：rAF 节流，只读布局不写 DOM
  useEffect(() => {
    const box = scrollRef.current;
    if (!box || headings.length === 0) return;
    let raf = 0;
    const calc = () => {
      raf = 0;
      const top = box.getBoundingClientRect().top + 90;
      let cur = -1;
      headings.forEach((h, i) => {
        const el = document.getElementById(h.id);
        if (el && el.getBoundingClientRect().top <= top) cur = i;
      });
      setActive(cur);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(calc);
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    calc();
    return () => {
      box.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [headings, post.id]);

  const jump = (id: string) => {
    const el = document.getElementById(id);
    const box = scrollRef.current;
    if (!el || !box) return;
    const delta = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    box.scrollTo({ top: box.scrollTop + delta - 16, behavior: "smooth" });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg font-mono">
      {/* 顶栏 */}
      <div className="flex h-[48px] flex-none items-center gap-3 border-b border-line px-4 text-[10.5px] text-tx3 sm:px-6">
        <button
          className="flex flex-none items-center gap-1.5 text-tx2 transition-colors hover:text-acc"
          onClick={onBack}
        >
          <Icon name="back" size={13} />
          {embedded ? "返回列表" : "返回博客"}
        </button>
        <span className="hidden min-w-0 truncate md:inline">blog://{post.slug}</span>
        <span className="ml-auto flex flex-none items-center gap-1.5">
          <Icon name="clock" size={12} />
          {post.charCount} 字 · 约 {readMinutes(post.charCount)} 分钟
        </span>
      </div>

      {/* 滚动区 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-[1020px] grid-cols-1 items-start gap-10 px-5 py-9 lg:grid-cols-[190px_minmax(0,680px)] lg:justify-center">
          {/* 左目录：窄屏收到正文上方双栏 */}
          {headings.length > 0 && (
            <nav className="max-h-[calc(100vh-160px)] overflow-y-auto max-[1020px]:columns-2 max-[1020px]:gap-6 lg:sticky lg:top-4">
              <div className="mb-2.5 flex items-center gap-1.5 text-[9.5px] tracking-[0.16em] text-tx3">
                <Icon name="toc" size={11} />
                目录
              </div>
              {headings.map((h, i) => (
                <button
                  key={h.id}
                  className={`mb-1 block w-full break-inside-avoid border-l py-1 pl-3 text-left text-[11px] leading-relaxed transition-colors ${
                    i === active
                      ? "border-acc text-acc"
                      : "border-line text-tx3 hover:border-tx3 hover:text-tx2"
                  } ${h.level === 3 ? "pl-6 text-[10.5px]" : ""}`}
                  onClick={() => jump(h.id)}
                >
                  {h.text}
                </button>
              ))}
            </nav>
          )}

          {/* 版心 */}
          <article className="min-w-0">
            <div className="text-[10px] tracking-[0.16em] text-acc">
              {CATEGORY_META[post.category].label} · {post.slug}
            </div>
            <h1 className="mt-3 text-[23px] font-semibold leading-[1.6] text-tx sm:text-[25px]">
              {post.title}
            </h1>
            <div className="mt-3.5 flex flex-wrap items-center gap-3 text-[10.5px] text-tx3">
              {post.tags.length > 0 && (
                <span className="flex items-center gap-1 text-acc/85">
                  <Icon name="tag" size={11} />
                  {post.tags.join(" ")}
                </span>
              )}
              <span>{formatDate(post.publishedAt)}</span>
              <span className="flex items-center gap-1">
                <Icon name="comment" size={11} />
                {post.commentCount}
              </span>
            </div>
            <div className="my-6 h-px bg-gradient-to-r from-acc to-line" />
            {post.summary && (
              <p className="mb-6 border-l border-line pl-3 text-[12.5px] leading-relaxed text-tx2">
                {post.summary}
              </p>
            )}
            <BlogMarkdown text={post.contentMd} />
          </article>
        </div>

        {/* 上下篇 */}
        <nav className="mx-auto grid w-full max-w-[680px] grid-cols-2 gap-3.5 px-5">
          <button
            className="min-w-0 rounded border border-line px-4 py-3 text-left transition-colors hover:border-acc/60 hover:bg-acc/5 disabled:cursor-default disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-transparent"
            disabled={!post.prev}
            onClick={() => post.prev && onNavigate(post.prev.slug)}
          >
            <span className="flex items-center gap-1 font-mono text-[9.5px] tracking-[0.08em] text-tx3">
              <Icon name="prev" size={11} />
              上一篇（更新）
            </span>
            <span className="mt-1 block truncate text-[12px] text-tx2">
              {post.prev?.title ?? "— 已是最新 —"}
            </span>
          </button>
          <button
            className="min-w-0 rounded border border-line px-4 py-3 text-right transition-colors hover:border-acc/60 hover:bg-acc/5 disabled:cursor-default disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-transparent"
            disabled={!post.next}
            onClick={() => post.next && onNavigate(post.next.slug)}
          >
            <span className="flex items-center justify-end gap-1 font-mono text-[9.5px] tracking-[0.08em] text-tx3">
              下一篇（更早）
              <Icon name="next" size={11} />
            </span>
            <span className="mt-1 block truncate text-[12px] text-tx2">
              {post.next?.title ?? "— 已是更早 —"}
            </span>
          </button>
        </nav>

        {/* 评论 */}
        <div className="mt-10">
          <CommentThread
            page={comments}
            author={author}
            readOnly={readOnlyComments}
            onSubmit={onSubmitComment}
            onLoadMore={onLoadMoreComments}
            loadingMore={loadingMoreComments}
          />
        </div>

        {!embedded && (
          <div className="border-t border-line py-3 text-center font-mono text-[10px] text-tx3">
            AI-WORKBENCH · 独立阅读页 · 左侧目录随滚动高亮
          </div>
        )}
      </div>
    </div>
  );
}
