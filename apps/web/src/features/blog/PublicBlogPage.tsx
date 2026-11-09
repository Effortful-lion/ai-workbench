import { useEffect, useMemo, useState } from "react";
import type { BlogCommentDto, BlogPublicPostDetailDto, BlogPublicPostDto } from "@aiwb/shared";
import { MarkdownText } from "../../lib/markdown";
import PublicBackLink from "../public/PublicBackLink";

const CAT_LABEL: Record<string, string> = {
  kb: "#知识库",
  agent: "#Agent",
  pipe: "#管道",
  essay: "#随笔",
};

/** 游客公开博客 /b/:username（卡片墙）与 /b/:username/:slug（阅读页） */
export default function PublicBlogPage({ username, slug }: { username: string; slug?: string }) {
  return slug ? (
    <PostView username={username} slug={slug} />
  ) : (
    <ListView username={username} />
  );
}

/* ============ 列表：图纸卡片墙 ============ */
function ListView({ username }: { username: string }) {
  const [posts, setPosts] = useState<BlogPublicPostDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cat, setCat] = useState("#全部");

  useEffect(() => {
    fetch(`/api/blog/public/${encodeURIComponent(username)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? `HTTP ${r.status}`);
        return (await r.json()) as BlogPublicPostDto[];
      })
      .then(setPosts)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [username]);

  const cats = ["#全部", "#知识库", "#Agent", "#管道", "#随笔"];
  const catKey = (label: string) =>
    label === "#全部" ? null : Object.entries(CAT_LABEL).find(([, l]) => l === label)?.[0];
  const shown = (posts ?? []).filter((p) => {
    const k = catKey(cat);
    return !k || p.category === k;
  });

  return (
    <div className="grid-bg flex min-h-full flex-col px-4 py-8 font-mono">
      <div className="mx-auto w-[min(1100px,100%)]">
        <div className="mb-4 flex items-center justify-between text-[11px] text-tx3">
          <span className="min-w-0 truncate">
            <span className="text-acc">▸</span> AI-WORKBENCH · blog / {username}
          </span>
          <PublicBackLink />
        </div>

        <h1 className="text-[15px] tracking-[0.16em] text-tx">一墙图纸卡片</h1>
        <div className="mt-1.5 text-[11.5px] leading-relaxed text-tx2">
          每篇是一张贴在方格纸上的图纸：编号、标题、摘要、分类一目了然。悬停 2px 浮起，点击进入阅读页。
        </div>

        {/* 分类导航词 */}
        <div className="mt-4 flex flex-wrap items-center gap-1 text-[10.5px]">
          {cats.map((c) => (
            <button
              key={c}
              className={`rounded px-2 py-0.5 transition-colors ${c === cat ? "bg-acc/10 text-acc" : "text-tx3 hover:text-acc"}`}
              onClick={() => setCat(c)}
            >
              {c}
            </button>
          ))}
          <span className="ml-2 text-tx3">{shown.length} 篇</span>
        </div>

        {error && <div className="mt-6 text-[12px] text-err">✗ {error}</div>}
        {!posts && !error && <div className="mt-10 text-center text-[12px] text-tx3">⠋ 读取博客…</div>}

        {/* 卡片网格 */}
        {posts && (
          <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] items-start gap-3.5">
            {shown.length === 0 && (
              <div className="col-span-full py-10 text-center text-[11px] text-tx3">// 暂无文章</div>
            )}
            {shown.map((p) => (
              <article
                key={p.id}
                className="relative flex cursor-pointer flex-col gap-2 border border-line bg-bg1 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-acc/50 hover:bg-bg2"
                onClick={() => window.location.assign(`/b/${encodeURIComponent(username)}/${p.slug}`)}
              >
                {/* 图纸裁切角标 */}
                <span className="absolute -left-px -top-px h-2.5 w-2.5 border-l border-t border-line2 transition-all duration-200 group-hover:h-4 group-hover:w-4 hover:h-4 hover:w-4 hover:border-acc" />
                <span className="absolute -bottom-px -right-px h-2.5 w-2.5 border-b border-r border-line2 transition-all duration-200 hover:h-4 hover:w-4 hover:border-acc" />
                <div className="flex items-baseline gap-2.5 text-[9.5px] tracking-wider">
                  <span className="text-tx3">{p.slug}</span>
                  <span className="text-acc/75">{CAT_LABEL[p.category]}</span>
                </div>
                <h3 className="line-clamp-2 min-h-[2.6em] text-[13.5px] font-medium leading-relaxed text-tx transition-colors hover:text-acc">
                  {p.title}
                </h3>
                <p className="line-clamp-2 text-[11.5px] leading-relaxed text-tx2">{p.summary}</p>
                <div className="mt-auto flex items-center gap-2.5 border-t border-dashed border-line pt-2 text-[9.5px] text-tx3">
                  <span>{new Date(p.publishedAt).toISOString().slice(0, 10)}</span>
                  <span className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-sm bg-bg">
                    <span className="block h-full rounded-sm bg-line2" style={{ width: `${Math.min(100, 20 + p.commentCount * 20)}%` }} />
                  </span>
                  {p.commentCount > 0 && <span>💬{p.commentCount}</span>}
                </div>
              </article>
            ))}
          </div>
        )}

        <div className="mt-6 text-[10px] text-tx3">// public read-only · /b/{username}</div>
      </div>
    </div>
  );
}

/* ============ 阅读页：左目录 + 版心 + 评论 ============ */
function PostView({ username, slug }: { username: string; slug: string }) {
  const [post, setPost] = useState<BlogPublicPostDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<BlogCommentDto[] | null>(null);
  const [tocCur, setTocCur] = useState(-1);
  const [form, setForm] = useState({ nickname: "", content: "" });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const load = () => {
    fetch(`/api/blog/public/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? `HTTP ${r.status}`);
        return (await r.json()) as BlogPublicPostDetailDto;
      })
      .then(setPost)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(load, [username, slug]);

  const loadComments = () => {
    fetch(`/api/blog/public/${encodeURIComponent(username)}/${encodeURIComponent(slug)}/comments`)
      .then(async (r) => (r.ok ? ((await r.json()) as BlogCommentDto[]) : []))
      .then(setComments)
      .catch(() => setComments([]));
  };
  useEffect(loadComments, [username, slug]);

  /** 目录：正文 ## 小节 */
  const toc = useMemo(() => {
    if (!post) return [];
    return post.contentMd
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("## "))
      .map((l, i) => ({ id: `sec${i}`, text: l.slice(3).trim() }));
  }, [post]);

  /** 滚动高亮当前小节 */
  useEffect(() => {
    if (!toc.length) return;
    const onScroll = () => {
      let cur = -1;
      toc.forEach((t, i) => {
        const el = document.getElementById(t.id);
        if (el && el.getBoundingClientRect().top < 140) cur = i;
      });
      setTocCur(cur);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [toc]);

  const submitComment = async () => {
    if (!form.content.trim()) return;
    setSending(true);
    setSent(null);
    try {
      await fetch(`/api/blog/public/${encodeURIComponent(username)}/${encodeURIComponent(slug)}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nickname: form.nickname.trim() || "匿名", content: form.content.trim() }),
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? `HTTP ${r.status}`);
      });
      setSent("✓ 评论已发布");
      setForm({ nickname: form.nickname, content: "" });
      // 重取正文（评论数已变）
      load();
      loadComments();
    } catch (e) {
      setSent(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSending(false);
    }
  };

  if (error)
    return (
      <div className="grid-bg flex min-h-full flex-col items-center justify-center px-4 py-8 font-mono">
        <div className="text-[12px] text-err">✗ {error}</div>
        <div className="mt-3">
          <BackToList username={username} />
        </div>
      </div>
    );
  if (!post)
    return (
      <div className="grid-bg flex min-h-full items-center justify-center font-mono text-[12px] text-tx3">
        ⠋ 读取文章…
      </div>
    );

  return (
    <div className="grid-bg min-h-full font-mono">
      {/* 顶栏 */}
      <div className="sticky top-0 z-10 flex h-[46px] items-center gap-3 border-b border-line bg-bg px-5 text-[10.5px] text-tx3">
        <BackToList username={username} />
        <span className="min-w-0 truncate">{post.title}</span>
        <span className="ml-auto hidden flex-none sm:inline">{post.contentMd.length} 字符 · 约 {Math.max(1, Math.round(post.contentMd.length / 500))} 分钟</span>
      </div>

      <div className="mx-auto grid max-w-[1020px] grid-cols-1 items-start gap-10 px-5 py-10 lg:grid-cols-[180px_minmax(0,680px)] lg:justify-center">
        {/* 左侧目录 */}
        {toc.length > 0 && (
          <nav className="font-mono lg:sticky lg:top-[70px] lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto">
            <div className="mb-2.5 text-[9.5px] tracking-widest text-tx3">// 目录</div>
            {toc.map((t, i) => (
              <a
                key={t.id}
                href={`#${t.id}`}
                className={`block border-l border-line py-1 pl-3 text-[11px] leading-relaxed transition-colors ${
                  i === tocCur ? "border-acc text-acc" : "text-tx3 hover:text-tx2"
                }`}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(t.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                {t.text}
              </a>
            ))}
          </nav>
        )}

        {/* 文章版心 */}
        <article className="min-w-0">
          <div className="text-[10.5px] tracking-widest text-acc">{CAT_LABEL[post.category]} · {post.slug}</div>
          <h2 className="mt-3 text-[23px] font-semibold leading-relaxed text-tx">{post.title}</h2>
          <div className="mt-3.5 flex flex-wrap items-center gap-3.5 font-mono text-[10.5px] text-tx3">
            <span className="text-acc">{post.tags.join(" ")}</span>
            <span>{new Date(post.publishedAt).toISOString().slice(0, 10)}</span>
            <span>💬 {post.commentCount}</span>
          </div>
          <hr className="my-6 h-px border-0 bg-gradient-to-r from-acc to-line" />
          {post.summary && <p className="mb-5 text-[12px] text-tx2">// 摘要：{post.summary}</p>}
          {/* 正文：## 小节注入锚点 id */}
          <SectionedMarkdown text={post.contentMd} />
        </article>
      </div>

      {/* 评论 */}
      <CommentSection
        username={username}
        slug={slug}
        post={post}
        comments={comments}
        form={form}
        setForm={setForm}
        sending={sending}
        sent={sent}
        onSubmit={submitComment}
      />
    </div>
  );
}

/** MarkdownText 渲染前把 ## 标题替换为带锚点 id 的占位写法：MarkdownText 不透传 id，
 *  这里按 ## 切段，每段前插一个带 id 的锚点 span */
function SectionedMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const lines = text.split("\n");
    const out: { anchor?: string; md: string }[] = [];
    let buf: string[] = [];
    for (const line of lines) {
      if (/^##\s+/.test(line.trim())) {
        if (buf.length) out.push({ md: buf.join("\n") });
        buf = [];
        out.push({ anchor: `sec${out.filter((b) => b.anchor).length}`, md: line });
      } else {
        buf.push(line);
      }
    }
    if (buf.length) out.push({ md: buf.join("\n") });
    return out;
  }, [text]);

  let secIx = 0;
  return (
    <div className="text-[14px] leading-[2.05] text-body [&_h2]:mb-3 [&_h2]:border-l-2 [&_h2]:border-acc [&_h2]:pl-3 [&_h2]:text-[16.5px] [&_h2]:font-semibold [&_h2]:text-tx [&_h3]:mb-2 [&_h3]:text-[14.5px] [&_h3]:font-semibold [&_h3]:text-tx [&_h4]:font-semibold [&_li]:my-1 [&_p]:mb-4 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-line [&_pre]:bg-bg1 [&_pre]:p-3 [&_pre]:text-[12px] [&_blockquote]:border-l-2 [&_blockquote]:border-line2 [&_blockquote]:pl-3 [&_blockquote]:text-tx2 [&_code]:rounded [&_code]:bg-bg2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px] [&_code]:text-acc [&_table]:w-full [&_table]:text-[12px] [&_th]:border [&_th]:border-line [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1">
      {blocks.map((b, i) => {
        if (/^##\s+/.test(b.md.trim())) {
          const id = `sec${secIx++}`;
          return (
            <div key={i} id={id} className="scroll-mt-[70px] pt-2">
              <MarkdownText text={b.md} />
            </div>
          );
        }
        return <MarkdownText key={i} text={b.md} />;
      })}
    </div>
  );
}

/* ============ 评论（游客昵称制） ============ */
function CommentSection({
  username, slug, post, comments, form, setForm, sending, sent, onSubmit,
}: {
  username: string;
  slug: string;
  post: BlogPublicPostDetailDto;
  comments: BlogCommentDto[] | null;
  form: { nickname: string; content: string };
  setForm: (f: { nickname: string; content: string }) => void;
  sending: boolean;
  sent: string | null;
  onSubmit: () => void;
}) {
  return (
    <section className="mx-auto w-[min(680px,100%)] px-5 pb-20 font-mono">
      <div className="border-b border-line pb-3 text-[11px] tracking-widest text-tx2">// 评论 · {post.commentCount}</div>
      {/* 评论列表 */}
      {comments && comments.length > 0 && (
        <div className="mt-2">
          {comments.map((c) => (
            <div key={c.id} className="flex gap-3 border-b border-dashed border-line py-4">
              <span className="flex h-[30px] w-[30px] flex-none items-center justify-center border border-line2 bg-acc/5 text-[11px] text-acc">
                {c.nickname.slice(0, 2)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2.5 text-[10px] text-tx3">
                  <span className="text-[11px] text-tx2">{c.nickname}</span>
                  <span>{new Date(c.createdAt).toLocaleString()}</span>
                </div>
                <div className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-body">{c.content}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {/* 发表表单 */}
      <div className="mt-4 rounded border border-dashed border-line p-4">
        <div className="flex items-center gap-2.5 text-[12.5px]">
          <span className="text-acc">▸</span>
          <input
            className="w-[150px] border-b border-line bg-transparent pb-0.5 text-[12.5px] outline-none placeholder:text-tx3 focus:border-acc"
            placeholder="昵称（可留空：匿名）"
            maxLength={24}
            value={form.nickname}
            onChange={(e) => setForm({ ...form, nickname: e.target.value })}
          />
        </div>
        <textarea
          className="mt-2.5 min-h-[64px] w-full resize-y bg-transparent text-[13px] leading-relaxed outline-none placeholder:text-tx3"
          placeholder="说点什么…"
          value={form.content}
          onChange={(e) => setForm({ ...form, content: e.target.value })}
        />
        <div className="mt-2 flex items-center gap-3">
          <span className="text-[9.5px] text-tx3">// 游客评论即时可见 · 作者会收到站内信通知</span>
          {sent && <span className={`text-[10.5px] ${sent.startsWith("✗") ? "text-err" : "text-acc"}`}>{sent}</span>}
          <button
            className="ml-auto rounded border border-line2 px-3 py-1 text-[10.5px] text-tx2 transition-colors hover:border-acc hover:text-acc"
            disabled={sending}
            onClick={() => void onSubmit()}
          >
            {sending ? "⠋ 发布中" : "⏎ 发布评论"}
          </button>
        </div>
      </div>
    </section>
  );
}

function BackToList({ username }: { username: string }) {
  return (
    <button
      className="text-tx2 transition-colors hover:text-acc"
      onClick={() => window.location.assign(`/b/${encodeURIComponent(username)}`)}
    >
      ◄ 返回博客
    </button>
  );
}
