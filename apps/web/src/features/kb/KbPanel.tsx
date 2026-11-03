import { useCallback, useEffect, useState } from "react";
import type { KbAskResultDto, KbDocumentDto } from "@aiwb/shared";
import { api } from "../../lib/api";
import { useAuthStore } from "../../stores/auth";

const TEXT_EXT = [".txt", ".md", ".markdown", ".csv", ".json", ".log", ".yml", ".yaml"];

const STATUS_DOT: Record<KbDocumentDto["status"], string> = {
  embedded: "text-acc",
  pending: "text-warn",
  error: "text-err",
};
const STATUS_LABEL: Record<KbDocumentDto["status"], string> = {
  embedded: "已索引",
  pending: "处理中",
  error: "失败",
};

function isTextFile(f: File) {
  const name = f.name.toLowerCase();
  return (
    TEXT_EXT.some((ext) => name.endsWith(ext)) ||
    f.type.startsWith("text/") ||
    f.type === "application/json"
  );
}

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** AI 知识库：检索即对话 + 终端文件树式文档浏览 + 拖拽上传 */
export default function KbPanel() {
  const role = useAuthStore((s) => s.user?.role ?? "guest");
  // 与 ModelsPanel 一致：写操作仅 owner/member；服务端仍以 kb:write 权限兜底
  const canWrite = role === "owner" || role === "member";

  const [docs, setDocs] = useState<KbDocumentDto[]>([]);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<KbAskResultDto | null>(null);
  const [openCitation, setOpenCitation] = useState<number | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", content: "" });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const reload = useCallback(async () => {
    try {
      setDocs(await api<KbDocumentDto[]>("/kb/documents"));
      setDocsError(null);
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const ingest = async () => {
    const title = form.title.trim();
    const content = form.content;
    if (!title || !content.trim()) return;
    setUploading(true);
    setUploadError(null);
    try {
      await api("/kb/documents", {
        method: "POST",
        body: JSON.stringify({ title, content }),
      });
      setForm({ title: "", content: "" });
      setShowAdd(false);
      await reload();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const pickFiles = async (files: FileList | File[] | null) => {
    const file = files?.[0];
    if (!file) return;
    setUploadError(null);
    if (!isTextFile(file)) {
      setUploadError("一期仅支持文本类文件（.txt / .md / .csv / .json / .log / .yml）");
      return;
    }
    const content = await file.text();
    setForm({ title: file.name, content });
    setShowAdd(true);
  };

  const removeDoc = async (d: KbDocumentDto) => {
    try {
      await api(`/kb/documents/${d.id}`, { method: "DELETE" });
      await reload();
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : String(e));
    }
  };

  const ask = async () => {
    const q = query.trim();
    if (!q || asking) return;
    setAsking(true);
    setResult(null);
    setOpenCitation(null);
    try {
      setResult(await api<KbAskResultDto>("/kb/ask", {
        method: "POST",
        body: JSON.stringify({ query: q }),
      }));
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  };

  return (
    <div
      className="relative mx-auto w-[min(900px,96%)] py-8 font-mono"
      onDragOver={(e) => {
        e.preventDefault();
        if (canWrite) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (canWrite) void pickFiles(e.dataTransfer.files);
      }}
    >
      {/* 标题栏 */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs text-tx3">~/kb · AI 知识库</span>
          <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-tx3">
            {docs.length} docs
          </span>
        </div>
        {canWrite && (
          <div className="flex items-center gap-2">
            <button
              className="rounded border border-line px-2.5 py-1 text-[11px] text-tx2 hover:border-acc hover:text-acc"
              onClick={() => document.getElementById("kb-file-input")?.click()}
              title="选择文本文件"
            >
              ⤒ 选文件
            </button>
            <input
              id="kb-file-input"
              type="file"
              accept={TEXT_EXT.join(",")}
              className="hidden"
              onChange={(e) => {
                void pickFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              className="rounded border border-line px-2.5 py-1 text-[11px] text-tx2 hover:border-acc hover:text-acc"
              onClick={() => setShowAdd((v) => !v)}
            >
              {showAdd ? "× 收起" : "+ 粘贴文本"}
            </button>
          </div>
        )}
      </div>

      {/* 检索即对话 */}
      <div className="mb-5 rounded-lg border border-line bg-bg1">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5 focus-within:border-acc">
          <span className="text-acc">▸</span>
          <input
            className="flex-1 bg-transparent text-[13px] text-tx outline-none placeholder:text-tx3"
            placeholder="问知识库…（如「部署流程是什么？」⏎ 检索并回答）"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void ask();
            }}
            disabled={asking}
          />
          <button
            className="rounded border border-line px-2 py-0.5 text-[10px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
            onClick={() => void ask()}
            disabled={asking || !query.trim()}
          >
            {asking ? "⠋ 检索中" : "⏎ 回答"}
          </button>
        </div>

        {result && (
          <div className="px-3 py-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-tx3">
              <span className="text-acc">ai ›</span>
              <span className="rounded border border-line px-1">
                {result.source === "llm" ? `llm · ${result.model}` : "本地抽取"}
              </span>
              <span>embedding:{result.embedding}</span>
              <span>⏱ {result.latencyMs}ms</span>
              <span>citations:{result.citations.length}</span>
            </div>
            <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-tx">
              {result.answer}
            </div>
            {result.citations.length > 0 && (
              <div className="mt-3 border-t border-line pt-2">
                {result.citations.map((h, i) => (
                  <div key={`${h.docId}-${h.chunkIx}`}>
                    <button
                      className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-[11px] text-tx2 hover:bg-bg2 hover:text-acc"
                      onClick={() => setOpenCitation(openCitation === i ? null : i)}
                    >
                      <span className="text-acc">[{i + 1}]</span>
                      <span className="truncate">《{h.docTitle}》 片段 #{h.chunkIx}</span>
                      <span className="ml-auto text-tx3">{h.score.toFixed(3)}</span>
                    </button>
                    {openCitation === i && (
                      <div className="mb-2 rounded border border-dashed border-line bg-bg px-2 py-1.5 text-[12px] leading-relaxed text-tx2">
                        {h.text}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 上传表单 */}
      {showAdd && (
        <div className="mb-4 rounded-lg border border-line bg-bg1 p-4 text-[12px]">
          <div className="mb-3 text-[11px] text-tx3">
            // 一期支持纯文本类文档；保存后自动切分（~500 字）并写入向量库
          </div>
          <label className="mb-3 flex items-center gap-2">
            <span className="w-20 flex-none text-tx3">title:</span>
            <input
              className="flex-1 border-b border-line bg-transparent py-1 text-tx outline-none focus:border-acc"
              value={form.title}
              placeholder="如：部署手册.md"
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </label>
          <label className="mb-3 flex items-start gap-2">
            <span className="w-20 flex-none pt-1 text-tx3">content:</span>
            <textarea
              className="h-40 flex-1 resize-y border border-line bg-transparent p-2 text-tx outline-none focus:border-acc"
              value={form.content}
              placeholder="粘贴文档内容，或把文本文件拖到面板上…"
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            />
          </label>
          {uploadError && <div className="mb-2 text-err">✗ {uploadError}</div>}
          <div className="flex items-center gap-3">
            <button
              className="rounded border border-line px-3 py-1 text-[11px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
              disabled={uploading || !form.title.trim() || !form.content.trim()}
              onClick={() => void ingest()}
            >
              {uploading ? "⠋ 切分 / 向量化中" : "⏎ 入库"}
            </button>
            <span className="text-[10px] text-tx3">
              {form.content ? `${form.content.length} chars` : ""}
            </span>
          </div>
        </div>
      )}

      {docsError && (
        <div className="mb-3 rounded border border-err/50 bg-bg1 px-3 py-2 text-[12px] text-err">
          ✗ {docsError}
        </div>
      )}

      {/* 文档树 */}
      <div className="overflow-hidden rounded-lg border border-line bg-bg1">
        <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[11px] text-tx3">
          <span>~/kb</span>
          <span>拖拽文本文件到面板即可上传</span>
        </div>
        {docs.length === 0 ? (
          <div className="px-4 py-12 text-center text-[12px] text-tx3">
            {docsError ? "// 知识库读取失败" : "// 知识库为空 —— 点击右上角「选文件」或「粘贴文本」"}
          </div>
        ) : (
          <div className="py-1">
            {docs.map((d, i) => (
              <div
                key={d.id}
                className="group flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-bg2"
              >
                <span className="text-tx3">{i === docs.length - 1 ? "└──" : "├──"}</span>
                <span className={STATUS_DOT[d.status]}>●</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-tx">{d.title}</span>
                  <span className="block truncate text-[10px] text-tx3">
                    {d.path} · {humanSize(d.size)} · {d.chunkCount} chunks · {STATUS_LABEL[d.status]}
                  </span>
                  {d.status === "error" && d.error && (
                    <span className="block truncate text-[10px] text-err">{d.error}</span>
                  )}
                </span>
                {canWrite && (
                  <button
                    className="invisible text-[11px] text-tx3 group-hover:visible hover:text-err"
                    onClick={() => void removeDoc(d)}
                    title="删除文档及其向量"
                  >
                    ✗ 删除
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 拖拽遮罩 */}
      {dragging && (
        <div className="pointer-events-none absolute inset-4 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-acc bg-bg/80 text-[13px] text-acc">
          ⤒ 松开以读取文本并加入上传表单
        </div>
      )}
    </div>
  );
}
