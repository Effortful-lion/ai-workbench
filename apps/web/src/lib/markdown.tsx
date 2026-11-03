import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

/** 终端风格 Markdown：只放行语法渲染，不解析原始 HTML */
const components: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  h1: ({ children }) => (
    <h1 className="mb-2 mt-4 text-[15px] font-semibold text-acc first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-3 text-[14px] font-semibold text-acc first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-3 text-[13px] font-semibold text-tx first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1.5 mt-2 text-[12.5px] font-semibold text-tx2 first:mt-0">{children}</h4>
  ),
  ul: ({ children }) => <ul className="my-1.5 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-tx">{children}</strong>,
  em: ({ children }) => <em className="italic text-tx2">{children}</em>,
  del: ({ children }) => <del className="text-tx3 line-through">{children}</del>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-acc underline decoration-dotted underline-offset-2 hover:decoration-solid"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-3 border-line" />,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-acc/60 pl-3 text-tx2">{children}</blockquote>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded border border-line bg-bg2 px-3 py-2 font-mono text-[12px] leading-relaxed [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const block = Boolean(className?.startsWith("language-"));
    if (block) return <code className="font-mono">{children}</code>;
    return (
      <code className="rounded border border-line bg-bg2 px-1 py-0.5 font-mono text-[12px] text-acc">
        {children}
      </code>
    );
  },
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded border border-line">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-bg2">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-line px-2 py-1 text-left font-medium text-tx">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b border-line/60 px-2 py-1 align-top text-tx2">{children}</td>
  ),
  img: ({ src, alt }) => (
    <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} className="my-2 max-w-full rounded border border-line" />
  ),
};

/** 把 AI 回复按 Markdown 语法渲染；纯文本仍保持原有段落观感 */
export function MarkdownText({ text }: { text: string }) {
  return (
    <div className="break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
