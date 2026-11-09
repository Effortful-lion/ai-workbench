import { useState } from "react";
import type { BlogCommentDto } from "@aiwb/shared";
import { Icon } from "../../lib/icons";
import { avatarText, formatDateTime } from "./blogUtils";

interface Props {
  comments: BlogCommentDto[];
  /** 只读模式（博客面板）：不渲染表单 */
  readOnly?: boolean;
  onSubmit?: (input: { nickname: string; content: string }) => Promise<void>;
}

/** 评论区：一层、游客昵称制、即时可见（后续接完整设计与审核） */
export default function CommentThread({ comments, readOnly, onSubmit }: Props) {
  const [nickname, setNickname] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async () => {
    if (!onSubmit || !content.trim() || sending) return;
    setSending(true);
    setMsg(null);
    try {
      await onSubmit({ nickname: nickname.trim() || "匿名", content: content.trim() });
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
          <div className="flex items-center gap-2.5 text-[12.5px]">
            <span className="text-acc">▸</span>
            <input
              className="w-[150px] border-b border-line bg-transparent pb-0.5 text-[12.5px] outline-none placeholder:text-tx3 focus:border-acc"
              placeholder="昵称（留空=匿名）"
              maxLength={24}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
          </div>
          <textarea
            className="mt-2.5 min-h-[64px] w-full resize-y bg-transparent text-[13px] leading-relaxed outline-none placeholder:text-tx3"
            placeholder="说点什么…"
            maxLength={2000}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="text-[9.5px] text-tx3">// 游客评论即时可见 · 作者会收到站内信通知</span>
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
        </div>
      )}
    </section>
  );
}
