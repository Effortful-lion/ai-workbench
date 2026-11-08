import { useCallback, useEffect, useRef, useState } from "react";
import type {
  KbAskMode, KbAskResultDto, KbDocumentDto, KbFolderNodeDto, KbFolderTreeDto,
} from "@aiwb/shared";
import KbTreeView, { KB_DOC_DRAG } from "./KbTreeView";
import { api } from "../../lib/api";
import { MarkdownText } from "../../lib/markdown";
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

/** 一轮问答：问题 + 结果/错误/是否被用户停止 */
interface Turn {
  q: string;
  result?: KbAskResultDto;
  error?: string;
  aborted?: boolean;
}

type Tab = "chat" | "docs";

/** AI 知识库：问答页（对话式，输入框在底部）+ 文档管理页（上传/重试/删除） */
export default function KbPanel() {
  const role = useAuthStore((s) => s.user?.role ?? "guest");
  // 与 ModelsPanel 一致：写操作仅 owner/member；服务端仍以 kb:write 权限兜底
  const canWrite = role === "owner" || role === "member";

  const [tab, setTab] = useState<Tab>("chat");
  const [docs, setDocs] = useState<KbDocumentDto[]>([]);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [tree, setTree] = useState<KbFolderTreeDto>({ folders: [], links: [] });
  /** 检索范围：null=全部文档（扁平层）；目录 id=该目录（含子目录）挂载的文档 */
  const [scopeFolderId, setScopeFolderId] = useState<string | null>(null);
  const [dragDoc, setDragDoc] = useState<string | null>(null);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [query, setQuery] = useState("");
  /** 检索深度：quick=向量直取（秒级）/ deep=图谱推理（跨文档多跳） */
  const [mode, setMode] = useState<KbAskMode>("deep");
  const [asking, setAsking] = useState(false);
  /** 当前提问的取消句柄：点「停止」时中断 fetch，不再等待结果 */
  const askAbort = useRef<AbortController | null>(null);
  const [openCitation, setOpenCitation] = useState<string | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<{ title: string; content: string; folderId?: string }>({
    title: "",
    content: "",
  });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  /** 查看原文：从 aiwb-kb 桶拉取归档正文（不重新向量化） */
  const [viewing, setViewing] = useState<{ id: string; title: string; content: string } | null>(null);
  const [viewingLoading, setViewingLoading] = useState(false);

  const viewOriginal = useCallback(async (doc: KbDocumentDto) => {
    setViewing(null);
    setViewingLoading(true);
    try {
      const res = await api<{ id: string; title: string; content: string }>(
        `/kb/documents/${doc.id}/original`,
      );
      setViewing({ id: res.id, title: res.title, content: res.content });
    } catch (e) {
      setViewing({ id: doc.id, title: doc.title, content: `// 原文读取失败：${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setViewingLoading(false);
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      setDocs(await api<KbDocumentDto[]>("/kb/documents"));
      setDocsError(null);
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const reloadTree = useCallback(async () => {
    try {
      setTree(await api<KbFolderTreeDto>("/kb/folders"));
    } catch {
      // 目录视图加载失败不阻塞文档列表，静默保留旧数据
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 存在「处理中」文档时，每 3s 轮询列表直到全部翻转（embedded / error）
  const hasPending = docs.some((d) => d.status === "pending");
  useEffect(() => {
    if (!hasPending) return;
    const t = setTimeout(() => void reload(), 3000);
    return () => clearTimeout(t);
  }, [hasPending, docs, reload]);

  // 新回答出来时滚到底部
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, asking]);

  const ingest = async () => {
    const title = form.title.trim();
    const content = form.content;
    if (!title || !content.trim()) return;
    setUploading(true);
    setUploadError(null);
    try {
      await api("/kb/documents", {
        method: "POST",
        body: JSON.stringify({ title, content, ...(form.folderId ? { folderId: form.folderId } : {}) }),
      });
      setForm({ title: "", content: "" });
      setShowAdd(false);
      await reload();
      await reloadTree();
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
    setTab("docs");
  };

  const removeDoc = async (d: KbDocumentDto) => {
    try {
      await api(`/kb/documents/${d.id}`, { method: "DELETE" });
      await reload();
      await reloadTree();
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : String(e));
    }
  };

  const retryDoc = async (d: KbDocumentDto) => {
    try {
      await api(`/kb/documents/${d.id}/retry`, { method: "POST" });
      await reload();
      await reloadTree();
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : String(e));
    }
  };

  // ==================== 目录树操作（视图层） ====================

  /** 展平目录树（用于上传表单的主归属下拉与范围路径展示） */
  const flatFolders = (() => {
    const out: { id: string; label: string }[] = [];
    const walk = (nodes: KbFolderNodeDto[], prefix: string) => {
      for (const n of nodes) {
        out.push({ id: n.id, label: `${prefix}${n.name}/` });
        walk(n.children, `${prefix}${n.name}/`);
      }
    };
    walk(tree.folders, "");
    return out;
  })();

  /** 当前范围（含子目录）挂载的 docId 集合；null=全局 */
  const scopeDocIds = (() => {
    if (scopeFolderId === null) return null;
    const folderIds = new Set<string>([scopeFolderId]);
    const findNode = (nodes: KbFolderNodeDto[]): KbFolderNodeDto | null => {
      for (const n of nodes) {
        if (n.id === scopeFolderId) return n;
        const f = findNode(n.children);
        if (f) return f;
      }
      return null;
    };
    const root = findNode(tree.folders);
    if (root) {
      const stack = [root];
      while (stack.length) {
        const cur = stack.pop() as KbFolderNodeDto;
        for (const c of cur.children) {
          folderIds.add(c.id);
          stack.push(c);
        }
      }
    }
    return new Set(tree.links.filter((l) => folderIds.has(l.folderId)).map((l) => l.documentId));
  })();

  /** 该文档被挂载的目录数（>1 显示 ⛓ 徽标，提示软链接多挂载） */
  const mountCount = (docId: string) => tree.links.filter((l) => l.documentId === docId).length;

  /** 当前范围内可见的文档：null=全部；目录范围=挂载集合（含子目录） */
  const inScopeDocs = scopeDocIds ? docs.filter((d) => scopeDocIds.has(d.id)) : docs;

  const createFolder = async (parentId: string | null) => {
    const name = window.prompt("目录名：");
    if (!name?.trim()) return;
    try {
      await api("/kb/folders", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), ...(parentId ? { parentId } : {}) }),
      });
      await reloadTree();
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : String(e));
    }
  };

  const renameFolder = async (folderId: string) => {
    const name = window.prompt("新目录名：");
    if (!name?.trim()) return;
    try {
      await api(`/kb/folders/${folderId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim() }),
      });
      await reloadTree();
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : String(e));
    }
  };

  /** 删除目录：仅删视图与映射，文档本体/向量保留 */
  const deleteFolder = async (folderId: string) => {
    if (!window.confirm("删除目录将同时解除其下所有挂载链接（文档本体与向量保留），确认？")) return;
    try {
      await api(`/kb/folders/${folderId}`, { method: "DELETE" });
      if (scopeFolderId) setScopeFolderId(null);
      await reloadTree();
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : String(e));
    }
  };

  /** 拖拽挂载：一份文档可挂多个目录，重复挂载服务端幂等 */
  const mountDoc = async (docId: string, folderId: string) => {
    try {
      await api("/kb/links", {
        method: "POST",
        body: JSON.stringify({ documentId: docId, folderId }),
      });
      await reloadTree();
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : String(e));
    }
  };

  /** 移除链接：仅删映射行，文档本体/向量保留 */
  const unlinkDocFromScope = async (docId: string) => {
    if (scopeFolderId === null) return;
    const link = tree.links.find(
      (l) => l.documentId === docId && l.folderId === scopeFolderId,
    );
    if (!link) return;
    try {
      await api(`/kb/links/${link.id}`, { method: "DELETE" });
      await reloadTree();
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : String(e));
    }
  };

  const ask = async () => {
    const q = query.trim();
    if (!q || asking) return;
    const ac = new AbortController();
    askAbort.current = ac;
    setAsking(true);
    setOpenCitation(null);
    setTurns((ts) => [...ts, { q }]);
    setQuery("");
    try {
      const result = await api<KbAskResultDto>("/kb/ask", {
        method: "POST",
        body: JSON.stringify({ query: q, mode }),
        signal: ac.signal,
      }, 130_000);
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, result } : t)));
    } catch (e) {
      // 用户主动停止：标记为已停止，不当作错误展示
      if (e instanceof DOMException && e.name === "AbortError") {
        setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, aborted: true } : t)));
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, error: msg } : t)));
      }
    } finally {
      askAbort.current = null;
      setAsking(false);
    }
  };

  /** 停止本次提问：中断请求，立即恢复输入 */
  const stopAsk = () => {
    askAbort.current?.abort();
  };

  return (
    <div
      className="relative flex h-full flex-col font-mono"
      onDragOver={(e) => {
        e.preventDefault();
        // 内部目录拖拽（自定义 MIME）不触发文件上传遮罩
        if (canWrite && !e.dataTransfer.types.includes(KB_DOC_DRAG)) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (canWrite) void pickFiles(e.dataTransfer.files);
      }}
    >
      {/* 标题栏 + 页签 */}
      <div className="flex flex-none items-center justify-between border-b border-line px-4 py-2">
        <div className="flex items-center gap-1">
          <span className="mr-2 text-xs text-tx3">~/kb</span>
          {(["chat", "docs"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`rounded px-2.5 py-1 text-[11px] ${
                tab === t ? "bg-bg2 text-acc" : "text-tx3 hover:text-tx2"
              }`}
              onClick={() => setTab(t)}
            >
              {t === "chat" ? "▸ 问答" : `▸ 文档 (${docs.length})`}
            </button>
          ))}
        </div>
        {canWrite && tab === "docs" && (
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

      {tab === "chat" ? (
        <>
          {/* 问答消息区 */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="mx-auto w-[min(760px,100%)]">
              {turns.length === 0 && (
                <div className="py-16 text-center text-[12px] leading-loose text-tx3">
                  <div className="mb-2 text-acc">▸ 检索即对话</div>
                  // 基于知识库的 {docs.filter((d) => d.status === "embedded").length} 篇已索引文档作答
                  {scopeFolderId !== null && (
                    <div className="mb-1 text-[10px] text-warn">
                      // 问答为全局检索，不受目录范围限制（范围仅作用于目录检索）
                    </div>
                  )}
                  <br />
                  // 试试：「部署流程是什么？」「帮我总结 xxx」
                </div>
              )}
              {turns.map((t, ti) => (
                <div key={ti} className="mb-5">
                  {/* 用户问题 */}
                  <div className="mb-2 flex justify-end">
                    <div className="max-w-[85%] rounded-lg border border-line bg-bg2 px-3 py-2 text-[13px] text-tx">
                      {t.q}
                    </div>
                  </div>
                  {/* AI 回答 */}
                  <div className="flex justify-start">
                    <div className="max-w-[92%] min-w-0">
                      {!t.result && !t.error && !t.aborted && (
                        <div className="px-1 py-1 text-[12px] text-tx3">⠋ 检索并生成回答中…</div>
                      )}
                      {t.aborted && (
                        <div className="rounded-lg border border-line bg-bg1 px-3 py-2 text-[12px] text-tx3">
                          ■ 已停止本次回答
                        </div>
                      )}
                      {t.error && (
                        <div className="rounded-lg border border-err/50 bg-bg1 px-3 py-2 text-[12px] text-err">
                          ✗ {t.error}
                        </div>
                      )}
                      {t.result && (
                        <div className="rounded-lg border border-line bg-bg1 px-3 py-2.5">
                          <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-tx3">
                            <span className="text-acc">ai ›</span>
                            <span className="rounded border border-line px-1">
                              {t.result.source === "llm" ? `llm · ${t.result.model}` : "本地抽取"}
                            </span>
                            <span className="rounded border border-line px-1">
                              {t.result.mode === "quick" ? "⚡ quick" : "◆ deep"}
                            </span>
                            <span>⏱ {t.result.latencyMs}ms</span>
                            {t.result.citations.length > 0 && (
                              <span>citations:{t.result.citations.length}</span>
                            )}
                          </div>
                          <div className="text-[13px] leading-relaxed text-tx">
                            <MarkdownText text={t.result.answer} />
                          </div>
                          {t.result.citations.length > 0 && (
                            <div className="mt-3 border-t border-line pt-2">
                              {t.result.citations.map((h, i) => {
                                const key = `${ti}-${i}`;
                                return (
                                  <div key={key}>
                                    <button
                                      className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-[11px] text-tx2 hover:bg-bg2 hover:text-acc"
                                      onClick={() => setOpenCitation(openCitation === key ? null : key)}
                                    >
                                      <span className="text-acc">[{i + 1}]</span>
                                      <span className="truncate">《{h.docTitle}》 片段 #{h.chunkIx}</span>
                                      <span className="ml-auto text-tx3">{h.score.toFixed(3)}</span>
                                    </button>
                                    {openCitation === key && (
                                      <div className="mb-2 rounded border border-dashed border-line bg-bg px-2 py-1.5 text-[12px] leading-relaxed text-tx2">
                                        {h.text}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={chatBottomRef} />
            </div>
          </div>

          {/* 底部输入框 */}
          <div className="flex-none border-t border-line bg-bg1 px-4 py-3">
            <div className="mx-auto w-[min(760px,100%)]">
              {/* 检索深度开关：简单问题用 quick，跨文档推理用 deep */}
              <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[10px]">
                <span className="text-tx3">// 检索深度</span>
                {(["quick", "deep"] as KbAskMode[]).map((m) => (
                  <button
                    key={m}
                    className={`rounded border px-1.5 py-0.5 ${
                      mode === m
                        ? "border-acc text-acc"
                        : "border-line text-tx3 hover:border-acc hover:text-acc"
                    }`}
                    onClick={() => setMode(m)}
                    disabled={asking}
                    title={m === "quick" ? "仅向量直取，秒级返回" : "图谱+向量推理，可跨文档多跳"}
                  >
                    {m === "quick" ? "⚡ quick" : "◆ deep"}
                  </button>
                ))}
                <span className="text-tx3">
                  {mode === "quick" ? "单点事实 / 原文定位" : "跨文档归纳 / 多跳推理"}
                </span>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2.5 focus-within:border-acc">
                <span className="text-acc">▸</span>
                <input
                  className="flex-1 bg-transparent text-[13px] text-tx outline-none placeholder:text-tx3"
                  placeholder="问知识库…（⏎ 发送）"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void ask();
                  }}
                  disabled={asking}
                />
                {asking ? (
                  <button
                    className="rounded border border-err/60 px-2 py-0.5 text-[10px] text-err hover:bg-err/10"
                    onClick={stopAsk}
                    title="停止本次提问"
                  >
                    ■ 停止
                  </button>
                ) : (
                  <button
                    className="rounded border border-line px-2 py-0.5 text-[10px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
                    onClick={() => void ask()}
                    disabled={!query.trim()}
                  >
                    ⏎ 回答
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        /* 文档管理页：左目录树（视图层） + 右文档列表（存储层，扁平一份） */
        <div className="flex min-h-0 flex-1">
          <KbTreeView
            tree={tree}
            scopeFolderId={scopeFolderId}
            canWrite={canWrite}
            dragLabel={dragDoc ? (docs.find((d) => d.id === dragDoc)?.title ?? null) : null}
            onScopeChange={setScopeFolderId}
            onMountDoc={(docId, folderId) => void mountDoc(docId, folderId)}
            onUnlinkDoc={(docId) => void unlinkDocFromScope(docId)}
            onCreateFolder={(parentId) => void createFolder(parentId)}
            onRenameFolder={(id) => void renameFolder(id)}
            onDeleteFolder={(id) => void deleteFolder(id)}
          />
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="mx-auto w-[min(760px,100%)]">
              {/* 范围指示：机器检索层始终扁平，范围只是视图过滤 */}
              <div className="mb-3 flex items-center gap-2 text-[10px] text-tx3">
                <span>scope:</span>
                <span className={scopeFolderId ? "text-acc" : "text-tx2"}>
                  {scopeFolderId
                    ? `~/kb/${flatFolders.find((f) => f.id === scopeFolderId)?.label ?? ""}`
                    : "全部文档（全局扁平召回）"}
                </span>
                {scopeFolderId && (
                  <button className="text-tx3 hover:text-acc" onClick={() => setScopeFolderId(null)}>
                    × 清除范围
                  </button>
                )}
              </div>
            {/* 上传表单 */}
            {showAdd && (
              <div className="mb-4 rounded-lg border border-line bg-bg1 p-4 text-[12px]">
                <div className="mb-3 text-[11px] text-tx3">
                  // 一期支持纯文本类文档；保存后自动切分（~500 字）并写入向量库
                </div>
                <label className="mb-3 flex items-center gap-2">
                  <span className="w-20 flex-none text-tx3">folder:</span>
                  <select
                    className="flex-1 border-b border-line bg-transparent py-1 text-tx outline-none focus:border-acc"
                    value={form.folderId ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, folderId: e.target.value || undefined }))
                    }
                  >
                    <option value="">（未归类 ~/kb/）</option>
                    {flatFolders.map((f) => (
                      <option key={f.id} value={f.id}>
                        ~/kb/{f.label}
                      </option>
                    ))}
                  </select>
                </label>
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
                    {uploading ? "⠋ 提交中" : "⏎ 入库"}
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

            {/* 文档列表（存储层）：拖文档到左侧目录挂载 */}
            <div className="overflow-hidden rounded-lg border border-line bg-bg1">
              <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[11px] text-tx3">
                <span>~/kb · {scopeDocIds ? `${scopeDocIds.size} 篇挂载` : `${docs.length} 篇`}</span>
                <span>拖文档到左侧目录挂载 · 一份文档可挂多个目录</span>
              </div>
              {inScopeDocs.length === 0 ? (
                <div className="px-4 py-12 text-center text-[12px] text-tx3">
                  {docsError
                    ? "// 知识库读取失败"
                    : scopeFolderId
                      ? "// 该目录下暂无挂载文档 —— 把文档拖进来"
                      : "// 知识库为空 —— 点击右上角「选文件」或「粘贴文本」"}
                </div>
              ) : (
                <div className="py-1">
                  {inScopeDocs.map((d, i) => (
                    <div
                      key={d.id}
                      className={`group flex cursor-pointer items-center gap-3 px-3 py-2 text-[12px] hover:bg-bg2 ${
                        dragDoc === d.id ? "opacity-40" : ""
                      }`}
                      draggable={canWrite}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(KB_DOC_DRAG, d.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragDoc(d.id);
                      }}
                      onDragEnd={() => setDragDoc(null)}
                      onClick={() => void viewOriginal(d)}
                      role="button"
                      tabIndex={0}
                      title="点击查看归档原文；可拖到左侧目录挂载"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void viewOriginal(d);
                      }}
                    >
                      <span className="text-tx3">{i === inScopeDocs.length - 1 ? "└──" : "├──"}</span>
                      <span className={STATUS_DOT[d.status]}>●</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-tx">{d.title}</span>
                        <span className="block truncate text-[10px] text-tx3">
                          {d.path} · {humanSize(d.size)} · {d.chunkCount} chunks · {STATUS_LABEL[d.status]}
                          {mountCount(d.id) > 1 && ` · ⛓ ${mountCount(d.id)} 目录挂载`}
                        </span>
                        {d.status === "error" && d.error && (
                          <span className="block truncate text-[10px] text-err">{d.error}</span>
                        )}
                      </span>
                      {canWrite && (
                        <span className="invisible flex items-center gap-2 group-hover:visible">
                          <button
                            className="text-[11px] text-tx3 hover:text-acc"
                            onClick={(e) => {
                              e.stopPropagation();
                              void viewOriginal(d);
                            }}
                            title="查看归档原文"
                          >
                            👁 原文
                          </button>
                          {d.status === "error" && (
                            <button
                              className="text-[11px] text-tx3 hover:text-acc"
                              onClick={(e) => {
                                e.stopPropagation();
                                void retryDoc(d);
                              }}
                              title="从归档原文重新切分/向量化"
                            >
                              ↻ 重试
                            </button>
                          )}
                          {scopeFolderId && (
                            <button
                              className="text-[11px] text-tx3 hover:text-warn"
                              onClick={(e) => {
                                e.stopPropagation();
                                void unlinkDocFromScope(d.id);
                              }}
                              title="移除链接：仅解除当前目录挂载，文档本体与向量保留"
                            >
                              ✂ 移除链接
                            </button>
                          )}
                          <button
                            className="text-[11px] text-tx3 hover:text-err"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!window.confirm(`删除文档本体？《${d.title}》将从所有目录消失，向量切片一并清除。`)) return;
                              void removeDoc(d);
                            }}
                            title="删除文档本体：源文件+全部向量+所有目录挂载"
                          >
                            ✗ 删除
                          </button>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            </div>
          </div>
        </div>
      )}

      {/* 拖拽遮罩 */}
      {dragging && (
        <div className="pointer-events-none absolute inset-4 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-acc bg-bg/80 text-[13px] text-acc">
          ⤒ 松开以读取文本并加入上传表单
        </div>
      )}

      {/* 原文查看抽屉 */}
      {viewing && (
        <div className="absolute inset-0 z-20 flex flex-col bg-bg">
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <span className="text-[13px] text-tx1 truncate">📄 {viewing.title}</span>
            <button
              className="text-[12px] text-tx3 hover:text-acc"
              onClick={() => setViewing(null)}
            >
              ✕ 关闭
            </button>
          </div>
          <div className="flex-1 overflow-auto px-4 py-3">
            {viewingLoading ? (
              <div className="text-[12px] text-tx3">读取中…</div>
            ) : (
              <div className="text-[13px] leading-relaxed text-tx1">
                <MarkdownText text={viewing.content} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
