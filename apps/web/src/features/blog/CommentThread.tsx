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

/** 评论区：两层树（一级 + 压平回复）、分页加载、回复 @人、待审提示 */
export default function CommentThread({
  page, author, readOnly, onSubmit, onLoadMore, loadingMore,
}: Props) {
  const [content, setContent] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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
  const total = page?.total ?? 0;

  return (
    <section className="mx-auto w-full max-w-[680px] px-5 pb-16 font-mono">
      <div className="flex items-center gap-2 border-b border-line pb-3 text-[11px] tracking-[0.08em] text-tx2">
        <Icon name="comment" size={12} />
        <span>评论 · {total}</span>
      </div>

      {threads.length === 0 ? (
        <div className="py-8 text-center text-[11px] text-tx3">// 还没有评论，写下第一条</div>
      ) : (
        <div>
          {threads.map((t, i) => (
            <div key={t.root.id} className="border-b border-dashed border-line py-4">
              <CommentRow
                c={t.root}
                floor={total - i}
                canReply={!readOnly && !!author}
                onReply={() => setReplyTo({ id: t.root.id, name: t.root.nickname })}
              />
              {t.children.length > 0 && (
                <div className="mt-2.5 border-l border-line pl-3 sm:ml-[42px]">
                  {t.children.map((c) => (
                    <div key={c.id} className="py-2.5">
                      <CommentRow
                        c={c}
                        compact
                        canReply={!readOnly && !!author}
                        onReply={() => setReplyTo({ id: c.id, name: c.nickname })}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {onLoadMore && threads.length < total && (
        <div className="mt-4 flex justify-center">
          <button
            className="rounded border border-line px-3 py-1 text-[10.5px] text-tx2 transition-colors hover:border-acc hover:text-acc disabled:opacity-50"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? "加载中…" : `加载更多（${total - threads.length}）`}
          </button>
        </div>
      )}

      {!readOnly && onSubmit && (
        <div className="mt-5 rounded border border-dashed border-line p-4">
          {!author ? (
            <div className="flex flex-wrap items-center gap-3 text-[12px] text-tx3">
              <Icon name="comment" size={13} />
              <span>评论公开可见，发表评论需要登录</span>
              <button
                className="ml-auto flex items-center gap-1.5 rounded border border-acc/50 px-3 py-1 text-[10.5px] text-acc transition-colors hover:bg-acc/10"
                onClick={() => window.location.assign("/")}
              >
                去登录
                <Icon name="next" size={11} />
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2.5 text-[12px]">
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
                className="mt-2.5 min-h-[64px] w-full resize-y bg-transparent text-[13px] leading-relaxed outline-none placeholder:text-tx3"
                placeholder={replyTo ? `回复 @${replyTo.name}…` : "说点什么…"}
                maxLength={2000}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="text-[9.5px] text-tx3">
                  // 评论公开可见 · 含敏感词/过多链接会进入人工审核
                </span>
                {msg && (
                  <span className={`text-[10.5px] ${msg.startsWith("✗") ? "text-err" : "text-acc"}`}>{msg}</span>
                )}
                <button
                  className="ml-auto flex items-center gap-1.5 rounded border border-line px-3 py-1 text-[10.5px] text-tx2 transition-colors hover:border-acc hover:text-acc disabled:opacity-50"
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

function CommentRow({
  c, floor, compact, canReply, onReply,
}: {
  c: BlogCommentDto;
  floor?: number;
  compact?: boolean;
  canReply?: boolean;
  onReply?: () => void;
}) {
  return (
    <div className="flex gap-3">
      <span
        className={`flex flex-none items-center justify-center border border-line bg-acc/5 text-acc ${
          compact ? "h-[24px] w-[24px] text-[10px]" : "h-[30px] w-[30px] text-[11px]"
        }`}
      >
        {avatarText(c.nickname)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[10px] text-tx3">
          <span className="text-[11px] text-tx2">{c.nickname}</span>
          {c.replyToUsername && c.depth > 0 && (
            <span className="text-tx3">
              回复 <span className="text-acc/80">@{c.replyToUsername}</span>
            </span>
          )}
          <span>{formatDateTime(c.createdAt)}</span>
          {floor !== undefined && <span className="ml-auto">#{floor}</span>}
          {canReply && (
            <button
              className={`text-[10px] text-tx3 transition-colors hover:text-acc ${floor === undefined ? "ml-auto" : ""}`}
              onClick={onReply}
            >
              回复
            </button>
          )}
        </div>
        <div className={`mt-1.5 whitespace-pre-wrap leading-relaxed text-tx2 ${compact ? "text-[12.5px]" : "text-[13px]"}`}>
          {c.content}
        </div>
      </div>
    </div>
  );
}
