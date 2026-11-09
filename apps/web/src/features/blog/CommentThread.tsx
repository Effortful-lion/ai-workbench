import { useState } from "react";
import type { BlogCommentDto } from "@aiwb/shared";
import { Icon } from "../../lib/icons";
import { avatarText, formatDateTime } from "./blogUtils";

interface Props {
  comments: BlogCommentDto[];
  /** 当前登录用户名：null = 未登录（只读展示 + 登录引导） */
  author?: string | null;
  /** 只读模式（博客面板）：不渲染表单 */
  readOnly?: boolean;
  onSubmit?: (input: { content: string }) => Promise<void>;
}

/** 评论区：公开可见、发表需登录（昵称自动取当前账号），一层结构 */
export default function CommentThread({ comments, author, readOnly, onSubmit }: Props) {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async () => {
    if (!onSubmit || !content.trim() || sending) return;
    setSending(true);
    setMsg(null);
    try {
      await onSubmit({ content: content.trim() });
      setContent("");
      setMsg("✓ 评论已发布");
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-[680px] px-5 pb-16 font-mono">
      <div className="flex items-center gap-2 border-b border-line pb-3 text-[11px] tracking-[0.08em] text-tx2">
        <Icon name="comment" size={12} />
        <span>评论 · {comments.length}</span>
      </div>

      {comments.length === 0 ? (
        <div className="py-8 text-center text-[11px] text-tx3">// 还没有评论，写下第一条</div>
      ) : (
        comments.map((c, i) => (
          <div key={c.id} className="flex gap-3 border-b border-dashed border-line py-4">
            <span className="flex h-[30px] w-[30px] flex-none items-center justify-center border border-line bg-acc/5 text-[11px] text-acc">
              {avatarText(c.nickname)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2.5 text-[10px] text-tx3">
                <span className="text-[11px] text-tx2">{c.nickname}</span>
                <span>{formatDateTime(c.createdAt)}</span>
                <span className="ml-auto">#{comments.length - i}</span>
              </div>
              <div className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-tx2">
                {c.content}
              </div>
            </div>
          </div>
        ))
      )}

      {!readOnly && onSubmit && (
        <div className="mt-5 rounded border border-dashed border-line p-4">
          {author ? (
            <>
              <div className="flex items-center gap-2.5 text-[12px]">
                <span className="flex h-[24px] w-[24px] items-center justify-center border border-line bg-acc/5 text-[10px] text-acc">
                  {avatarText(author)}
                </span>
                <span className="text-tx2">以</span>
                <span className="text-acc">@{author}</span>
                <span className="text-tx3">身份评论</span>
              </div>
              <textarea
                className="mt-2.5 min-h-[64px] w-full resize-y bg-transparent text-[13px] leading-relaxed outline-none placeholder:text-tx3"
                placeholder="说点什么…"
                maxLength={2000}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="text-[9.5px] text-tx3">// 评论公开可见 · 作者会收到站内信通知</span>
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
          ) : (
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
          )}
        </div>
      )}
    </section>
  );
}
