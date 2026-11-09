import { useState } from "react";
import type { BlogCommentDto, BlogCommentPageDto } from "@aiwb/shared";
import { Icon } from "../../lib/icons";
import { avatarText, formatDateTime } from "./blogUtils";

interface Props {
  page: BlogCommentPageDto | null;
  /** 当前登录用户名：null = 未登录（只读展示 + 登录引导） */
  author?: string | null;
  /** 只读模式（博客面板阅读）：不渲染表单与回复 */
  readOnly?: boolean;
  onSubmit?: (input: { content: string; parentId?: string | null }) => Promise<BlogCommentDto>;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}

/** 收起时露出的一级楼层数 */
const COLLAPSED_FLOORS = 3;
/** 收起时每个楼层露出的回复数 */
const COLLAPSED_REPLIES = 2;

/**
 * 评论区：UI 只做两级。
 * 一级楼层顶格；所有回复（后端 depth 恒为 1）统一缩进一级，
 * 第三层及更深的信息由「回复 @某人」承担，不再继续缩进。
 */
export default function CommentThread({
  page, author, readOnly, onSubmit, onLoadMore, loadingMore,
}: Props) {
  const [content, setContent] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  /** 一级楼层是否已展开全部 */
  const [expanded, setExpanded] = useState(false);
  /** 楼层内回复展开状态：rootId → true */
  const [openReplies, setOpenReplies] = useState<Record<string, boolean>>({});

  const submit = async () => {
    if (!onSubmit || !content.trim() || sending) return;
    setSending(true);
    setMsg(null);
    try {
      const c = await onSubmit({ content: content.trim(), parentId: replyTo?.id ?? null });
      setContent("");
      setReplyTo(null);
      setMsg(c.status === "pending" ? "✓ 已提交，待作者审核后公开" : "✓ 评论已发布");
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSending(false);
    }
  };

  const threads = page?.threads ?? [];
  /** 一级楼层数：分页依据 */
  const floorTotal = page?.total ?? 0;
  /** 评论总条数（含回复）：标题展示，避免「只有 2 条」的误读 */
  const total = page?.commentTotal ?? floorTotal;

  const visibleThreads = expanded ? threads : threads.slice(0, COLLAPSED_FLOORS);
  const hiddenFloors = floorTotal - visibleThreads.length;

  return (
    <section className="w-full font-mono">
      <div className="flex items-center gap-2 text-[10.5px] tracking-[0.08em] text-tx3">
        <Icon name="comment" size={12} />
        <span>评论 · {total}</span>
        {floorTotal > 0 && <span className="text-tx3/60">/ {floorTotal} 个楼层</span>}
      </div>

      {threads.length === 0 ? (
        <div className="py-8 text-[11px] text-tx3">// 还没有评论，写下第一条</div>
      ) : (
        <div className="mt-6 flex flex-col gap-8">
          {visibleThreads.map((t, i) => {
            const opened = openReplies[t.root.id];
            const kids = opened ? t.children : t.children.slice(0, COLLAPSED_REPLIES);
            const restKids = t.children.length - kids.length;
            return (
              <div key={t.root.id}>
                <CommentRow
                  c={t.root}
                  floor={floorTotal - i}
                  canReply={!readOnly && !!author}
                  onReply={() => setReplyTo({ id: t.root.id, name: t.root.nickname })}
                />
                {t.children.length > 0 && (
                  <div className="mt-4 flex flex-col gap-6 border-l border-line/70 pl-8">
                    {kids.map((c) => (
                      <CommentRow
                        key={c.id}
                        c={c}
                        compact
                        canReply={!readOnly && !!author}
                        onReply={() => setReplyTo({ id: c.id, name: c.nickname })}
                      />
                    ))}
                    {restKids > 0 && (
                      <button
                        className="self-start text-[10.5px] text-tx3 transition-colors hover:text-acc"
                        onClick={() => setOpenReplies((s) => ({ ...s, [t.root.id]: true }))}
                      >
                        展开其余 {restKids} 条回复
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 收起态的「展开全部」：同时补拉下一页，避免点了没反应 */}
      {!expanded && hiddenFloors > 0 && (
        <div className="mt-6 flex">
          <button
            className="rounded border border-line px-4 py-1 text-[10.5px] text-tx2 transition-colors hover:border-acc hover:text-acc"
            onClick={() => {
              setExpanded(true);
              if (threads.length < floorTotal) onLoadMore?.();
            }}
          >
            展开全部 {total} 条评论
          </button>
        </div>
      )}

      {/* 展开后仍有未加载的分页 */}
      {expanded && onLoadMore && threads.length < floorTotal && (
        <div className="mt-6 flex">
          <button
            className="rounded border border-line px-4 py-1 text-[10.5px] text-tx2 transition-colors hover:border-acc hover:text-acc disabled:opacity-50"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? "加载中…" : `加载更多（${floorTotal - threads.length} 个楼层）`}
          </button>
        </div>
      )}

      {!readOnly && onSubmit && (
        <div className="mt-8 border border-line p-4">
          {!author ? (
            <div className="flex flex-wrap items-center gap-4 text-[12px] text-tx3">
              <Icon name="comment" size={13} />
              <span>评论公开可见，发表评论需要登录</span>
              <button
                className="ml-auto flex items-center gap-1.5 rounded border border-acc/50 px-4 py-1 text-[10.5px] text-acc transition-colors hover:bg-acc/10"
                onClick={() => window.location.assign("/")}
              >
                去登录
                <Icon name="next" size={11} />
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="flex h-[24px] w-[24px] items-center justify-center border border-line bg-acc/5 text-[10px] text-acc">
                  {avatarText(author)}
                </span>
                <span className="text-tx3">以</span>
                <span className="text-acc">@{author}</span>
                <span className="text-tx3">身份评论</span>
                {replyTo && (
                  <span className="flex items-center gap-1.5 rounded border border-acc/40 px-2 py-0.5 text-[10.5px] text-acc">
                    回复 @{replyTo.name}
                    <button className="text-tx3 hover:text-err" onClick={() => setReplyTo(null)}>
                      ✕
                    </button>
                  </span>
                )}
              </div>
              <textarea
                className="mt-2 min-h-[64px] w-full resize-y bg-transparent text-[13px] leading-relaxed outline-none placeholder:text-tx3"
                placeholder={replyTo ? `回复 @${replyTo.name}…` : "说点什么…"}
                maxLength={2000}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
              <div className="mt-2 flex flex-wrap items-center gap-4">
                <span className="text-[9.5px] text-tx3">
                  // 评论公开可见 · 含敏感词/过多链接会进入人工审核
                </span>
                {msg && (
                  <span className={`text-[10.5px] ${msg.startsWith("✗") ? "text-err" : "text-acc"}`}>{msg}</span>
                )}
                <button
                  className="ml-auto flex items-center gap-1.5 rounded border border-line px-4 py-1 text-[10.5px] text-tx2 transition-colors hover:border-acc hover:text-acc disabled:opacity-50"
                  disabled={sending || !content.trim()}
                  onClick={() => void submit()}
                >
                  <Icon name="publish" size={12} />
                  {sending ? "发布中…" : "发布评论"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * 单条评论：一级顶格（正文 x=0，头像外移）；
 * 二级由父级 `pl-6` 缩进一级，头像/楼层号仍向容器外偏移。
 */
function CommentRow({
  c, floor, compact, canReply, onReply,
}: {
  c: BlogCommentDto;
  floor?: number;
  compact?: boolean;
  canReply?: boolean;
  onReply?: () => void;
}) {
  const box = compact ? "h-[24px] w-[24px] text-[10px]" : "h-[32px] w-[32px] text-[11px]";
  return (
    <div className="relative flex gap-4 lg:gap-0">
      <span
        className={`flex flex-none items-center justify-center border border-line bg-acc/5 text-acc lg:absolute lg:-left-10 lg:top-0 ${box}`}
      >
        {avatarText(c.nickname)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[10px]">
          <span className={`text-[11.5px] ${compact ? "text-tx2/80" : "text-tx2"}`}>{c.nickname}</span>
          {c.replyToUsername && c.depth > 0 && (
            <span className="text-tx3">
              回复 <span className="text-acc/80">@{c.replyToUsername}</span>
            </span>
          )}
          <span className="text-tx3/70">{formatDateTime(c.createdAt)}</span>
          {canReply && (
            <button
              className="ml-auto text-[10px] text-tx3 transition-colors hover:text-acc"
              onClick={onReply}
            >
              回复
            </button>
          )}
          {floor !== undefined && (
            <span className="text-[10px] text-tx3/60 lg:-right-10 lg:absolute lg:-top-0.5">
              #{floor}
            </span>
          )}
        </div>
        <div
          className={`mt-2 whitespace-pre-wrap leading-[1.95] text-tx2 ${
            compact ? "text-[13.5px]" : "text-[14px]"
          }`}
        >
          {c.content}
        </div>
      </div>
    </div>
  );
}
