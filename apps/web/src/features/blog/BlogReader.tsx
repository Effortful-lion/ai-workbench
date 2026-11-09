import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BlogCommentDto, BlogCommentPageDto, BlogPublicPostDetailDto } from "@aiwb/shared";
import { Icon } from "../../lib/icons";
import BlogMarkdown from "./BlogMarkdown";
import CommentThread from "./CommentThread";
import { CATEGORY_META, formatDate, parseHeadings, readMinutes, type Heading } from "./blogUtils";

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
  /** 评论区上方插槽（博主可见的「待审 N 条 · 去审核」提示条） */
  commentsNotice?: ReactNode;
}

/**
 * 深度阅读页：桌面常驻 sticky 目录 + 680px 版心。
 * 间距只用 16 / 24 / 32 / 48（8px 栅格），标题与正文共用同一条左基线。
 */
export default function BlogReader({
  post, comments, onBack, onNavigate, onSubmitComment, onLoadMoreComments,
  loadingMoreComments, author, readOnlyComments, embedded, commentsNotice,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headings = useMemo(() => parseHeadings(post.contentMd), [post.contentMd]);
  const [active, setActive] = useState(-1);
  const [tocOpen, setTocOpen] = useState(false);

  // 切篇回到顶部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setActive(-1);
  }, [post.id]);

  // scrollspy：rAF 节流，只读布局不写 DOM
  useEffect(() => {
    const box = scrollRef.current;
    if (!box || headings.length === 0) return;
    let raf = 0;
    const calc = () => {
      raf = 0;
      const line = box.getBoundingClientRect().top + 24;
      let cur = -1;
      headings.forEach((h, i) => {
        const el = document.getElementById(h.id);
        if (el && el.getBoundingClientRect().top <= line) cur = i;
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

  /** 锚点跳转：平滑滚动，预留 16px 呼吸位，跳完收起移动端下拉 */
  const jump = (id: string) => {
    const el = document.getElementById(id);
    const box = scrollRef.current;
    if (!el || !box) return;
    const delta = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    box.scrollTo({ top: box.scrollTop + delta - 16, behavior: "smooth" });
    setTocOpen(false);
  };

  const cat = CATEGORY_META[post.category];

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg font-mono">
      {/* 顶栏：只保留返回与路径，字数/时长下沉到元信息行，避免同一信息两处 */}
      <div className="flex h-[48px] flex-none items-center gap-3 border-b border-line px-6 text-[10.5px]">
        <button
          className="flex flex-none items-center gap-1.5 text-tx2 transition-colors hover:text-acc"
          onClick={onBack}
        >
          <Icon name="back" size={13} />
          {embedded ? "返回列表" : "返回博客"}
        </button>
        <span className="hidden min-w-0 truncate text-tx3 md:inline">blog://{post.slug}</span>
      </div>

      {/* 滚动区 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[960px] px-6 py-8">
          {/* 移动端：折叠为顶部下拉目录（桌面不渲染，桌面用左栏常驻目录） */}
          {headings.length > 0 && (
            <details
              className="mb-8 border border-line lg:hidden"
              open={tocOpen}
              onToggle={(e) => setTocOpen((e.target as HTMLDetailsElement).open)}
            >
              <summary className="flex cursor-pointer items-center gap-2 px-4 py-4 text-[10.5px] tracking-[0.08em] text-tx2">
                <Icon name="toc" size={12} />
                目录 · {headings.length} 节
              </summary>
              <div className="border-t border-line px-2 py-2">
                <TocList headings={headings} active={active} onJump={jump} />
              </div>
            </details>
          )}

          <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[190px_minmax(0,680px)]">
            {/* 桌面：左栏常驻 sticky，全程可见；与正文首行同一水平起始线 */}
            {headings.length > 0 && (
              <aside className="hidden max-h-[calc(100vh-96px)] overflow-y-auto lg:sticky lg:top-8 lg:block">
                <div className="mb-4 flex items-center gap-1.5 text-[9.5px] tracking-[0.16em] text-tx3">
                  <Icon name="toc" size={11} />
                  目录
                </div>
                <TocList headings={headings} active={active} onJump={jump} />
              </aside>
            )}

            <article className="min-w-0">
              {/* ① 标题 */}
              <h1 className="text-[26px] font-semibold leading-[1.35] text-tx sm:text-[28px]">
                {post.title}
              </h1>

              {/* ② 元信息行：标签为主，其余降权 */}
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10.5px]">
                <span className="flex items-center gap-1.5 text-acc">
                  <Icon name="tag" size={11} />
                  {post.tags.length > 0 ? post.tags.join(" · ") : cat.label}
                </span>
                <span className="text-tx2">{cat.label}</span>
                <span className="text-tx3">#{post.slug}</span>
                <span className="text-tx3">{formatDate(post.publishedAt)}</span>
                <span className="flex items-center gap-1.5 text-tx3">
                  <Icon name="clock" size={11} />
                  {post.charCount} 字 · {readMinutes(post.charCount)} 分钟
                </span>
                <span className="flex items-center gap-1.5 text-tx3">
                  <Icon name="comment" size={11} />
                  {post.commentCount}
                </span>
              </div>

              {/* ③ 分隔线：元信息与正文之间唯一一道，标题组内部靠留白 */}
              <div className="mt-6 border-t border-line" />

              {/* ④ 正文 */}
              <div className="mt-8">
                <BlogMarkdown text={post.contentMd} />
              </div>

              {/* ⑤ 上下篇：空状态不保留边框与等重容器 */}
              <nav className="mt-12 grid grid-cols-2 gap-4 border-t border-line pt-8">
                {post.prev ? (
                  <button
                    className="min-w-0 border border-line px-4 py-4 text-left transition-colors hover:border-acc/60 hover:bg-acc/5"
                    onClick={() => onNavigate(post.prev!.slug)}
                  >
                    <span className="flex items-center gap-1 text-[9.5px] tracking-[0.08em] text-tx3">
                      <Icon name="prev" size={11} />
                      上一篇（更新）
                    </span>
                    <span className="mt-2 block truncate text-[12px] text-tx2">{post.prev.title}</span>
                  </button>
                ) : (
                  <div className="min-w-0 cursor-default px-4 py-4 text-left">
                    <span className="flex items-center gap-1 text-[9.5px] tracking-[0.08em] text-tx3/50">
                      <Icon name="prev" size={11} />
                      上一篇（更新）
                    </span>
                    <span className="mt-2 block text-[12px] text-tx3/40">— 已是最新 —</span>
                  </div>
                )}
                {post.next ? (
                  <button
                    className="min-w-0 border border-line px-4 py-4 text-right transition-colors hover:border-acc/60 hover:bg-acc/5"
                    onClick={() => onNavigate(post.next!.slug)}
                  >
                    <span className="flex items-center justify-end gap-1 text-[9.5px] tracking-[0.08em] text-tx3">
                      下一篇（更早）
                      <Icon name="next" size={11} />
                    </span>
                    <span className="mt-2 block truncate text-[12px] text-tx2">{post.next.title}</span>
                  </button>
                ) : (
                  <div className="min-w-0 cursor-default px-4 py-4 text-right">
                    <span className="flex items-center justify-end gap-1 text-[9.5px] tracking-[0.08em] text-tx3/50">
                      下一篇（更早）
                      <Icon name="next" size={11} />
                    </span>
                    <span className="mt-2 block text-[12px] text-tx3/40">— 已是最早 —</span>
                  </div>
                )}
              </nav>

              {/* ⑥ 评论区：主体文字继续沿用阅读基线，头像/楼层号向外偏移 */}
              <section className="mt-12 border-t border-line pt-8">
                {commentsNotice}
                <CommentThread
                  page={comments}
                  author={author}
                  readOnly={readOnlyComments}
                  onSubmit={onSubmitComment}
                  onLoadMore={onLoadMoreComments}
                  loadingMore={loadingMoreComments}
                />
              </section>
            </article>
          </div>
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

/** 目录项：激活/悬停用绿色左标，缩进按 16 / 24 分两级 */
function TocList({
  headings, active, onJump,
}: {
  headings: Heading[];
  active: number;
  onJump: (id: string) => void;
}) {
  return (
    <nav className="flex flex-col">
      {headings.map((h, i) => (
        <button
          key={h.id}
          className={`w-full border-l py-2 text-left text-[11px] leading-relaxed transition-colors ${
            h.level === 3 ? "pl-6" : "pl-4"
          } ${
            i === active
              ? "border-acc text-acc"
              : "border-line text-tx3 hover:border-acc/60 hover:text-acc"
          }`}
          onClick={() => onJump(h.id)}
        >
          {h.text}
        </button>
      ))}
    </nav>
  );
}
