import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { splitSections } from "./blogUtils";

/**
 * 阅读版心 Markdown：与聊天用的 MarkdownText 分开，避免影响会话观感。
 * 基线约束：各级标题与段落共用同一条左边缘（不加 border-l / 左缩进），
 * 间距只用 16 / 24 / 32 / 48，章节之间靠留白而非线条区分。
 */
const components: Components = {
  p: ({ children }) => <p className="mb-6">{children}</p>,
  h1: ({ children }) => (
    <h1 className="mb-4 text-[20px] font-semibold leading-snug text-tx">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-4 text-[18px] font-semibold leading-snug text-tx">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-4 text-[15.5px] font-semibold leading-snug text-tx">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-4 mt-6 text-[14px] font-semibold text-tx2">{children}</h4>
  ),
  ul: ({ children }) => <ul className="mb-6 list-disc pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="mb-6 list-decimal pl-6">{children}</ol>,
  li: ({ children }) => <li className="mt-2 first:mt-0">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-tx">{children}</strong>,
  em: ({ children }) => <em className="italic text-tx2">{children}</em>,
  del: ({ children }) => <del className="text-tx3 line-through">{children}</del>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-acc underline decoration-dotted underline-offset-4 hover:decoration-solid"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-8 border-line" />,
  blockquote: ({ children }) => (
    <blockquote className="my-6 border-l-2 border-line pl-6 text-tx2 [&_p]:mb-4 [&_p:last-child]:mb-0">
      {children}
    </blockquote>
  ),
  pre: ({ children }) => (
    <pre className="my-6 overflow-x-auto rounded border border-line bg-bg1 p-4 font-mono text-[12.5px] leading-relaxed [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-tx2">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    if (className?.startsWith("language-")) return <code className="font-mono">{children}</code>;
    return (
      <code className="rounded border border-line bg-bg1 px-1 py-0.5 font-mono text-[12.5px] text-acc">
        {children}
      </code>
    );
  },
  table: ({ children }) => (
    <div className="my-6 overflow-x-auto rounded border border-line">
      <table className="w-full border-collapse text-[12.5px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-bg1">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-line px-4 py-2 text-left font-medium text-tx">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b border-line/60 px-4 py-2 align-top text-tx2">{children}</td>
  ),
  img: ({ src, alt }) => (
    <img
      src={typeof src === "string" ? src : undefined}
      alt={alt ?? ""}
      className="my-6 max-w-full rounded border border-line"
    />
  ),
};

/** 段落 + 小节锚点：id 与目录 parseHeadings 同源 */
export default function BlogMarkdown({ text }: { text: string }) {
  const sections = splitSections(text);
  return (
    <div className="break-words text-[15px] leading-[2.05] text-tx2 [&>section+section]:mt-8">
      {sections.map((s) => (
        <section key={s.id} id={s.id} className="scroll-mt-4">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
            {s.md}
          </ReactMarkdown>
        </section>
      ))}
    </div>
  );
}
