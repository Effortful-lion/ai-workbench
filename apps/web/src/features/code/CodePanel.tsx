import { useCallback, useEffect, useState } from "react";
import type {
  CodeFileDetailDto,
  CodeFileDto,
  CodeRepoDto,
} from "@aiwb/shared";
import { api } from "../../lib/api";
import { useAuthStore } from "../../stores/auth";

const TEXT_EXT = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".markdown",
  ".css", ".scss", ".html", ".go", ".py", ".rs", ".java", ".sh", ".yml",
  ".yaml", ".toml", ".sql", ".txt", ".env", ".gitignore",
];

function mmdd(ts: number) {
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

function isTextFile(f: File) {
  const name = f.name.toLowerCase();
  return (
    TEXT_EXT.some((ext) => name.endsWith(ext)) ||
    f.type.startsWith("text/") ||
    f.type === "application/json"
  );
}

/** repo.new <name> [language] [描述] → 建仓库；language 缺省 text */
function parseRepoNew(raw: string) {
  const src = raw.replace(/^repo\.new\s*/i, "").trim();
  if (!src) return { error: "用法：repo.new <name> [language] [描述]" };
  const tokens = src.split(/\s+/);
  const name = tokens[0] ?? "";
  if (!name) return { error: "缺少仓库名，如 repo.new ai-workbench typescript AI-first 工作台" };
  const language = tokens[1] && /^[a-z0-9+#._-]+$/i.test(tokens[1]) ? tokens[1] : undefined;
  const description = (language ? tokens.slice(2) : tokens.slice(1)).join(" ").trim();
  return { name, language, description: description || undefined };
}

/** file.new <path> → 在当前仓库下新建空文件 */
function parseFileNew(raw: string) {
  const path = raw.replace(/^file\.new\s*/i, "").trim();
  if (!path) return { error: "用法：file.new <path>（如 src/main.ts）" };
  return { path };
}

/** 代码管理：仓库卡片 + 文件树 + 在线查看/编辑/上传/下载 */
export default function CodePanel() {
  const role = useAuthStore((s) => s.user?.role ?? "guest");
  // 与原型 ACL 一致：owner rw，member ro；服务端 code:read / code:write 兜底
  const canWrite = role === "owner";

  const [repos, setRepos] = useState<CodeRepoDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [files, setFiles] = useState<CodeFileDto[]>([]);
  const [detail, setDetail] = useState<CodeFileDetailDto | null>(null);
  const [draft, setDraft] = useState("");

  const [loading, setLoading] = useState(true);
  const [filesLoading, setFilesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cmd, setCmd] = useState("");
  const [cmdError, setCmdError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = repos.find((r) => r.id === selectedId) ?? null;

  const reloadRepos = useCallback(async () => {
    try {
      const list = await api<CodeRepoDto[]>("/code/repos");
      setRepos(list);
      setSelectedId((prev) =>
        prev && list.some((r) => r.id === prev) ? prev : (list[0]?.id ?? null),
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFiles = useCallback(async (repoId: string) => {
    setFilesLoading(true);
    try {
      setFiles(await api<CodeFileDto[]>(`/code/repos/${repoId}/files`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadRepos();
  }, [reloadRepos]);

  useEffect(() => {
    setDetail(null);
    setDraft("");
    if (!selectedId) {
      setFiles([]);
      return;
    }
    void loadFiles(selectedId);
  }, [selectedId, loadFiles]);

  const openFile = async (file: CodeFileDto) => {
    if (!selectedId) return;
    try {
      const d = await api<CodeFileDetailDto>(`/code/repos/${selectedId}/files/${file.id}`);
      setDetail(d);
      setDraft(d.content);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const submitCmd = async () => {
    const src = cmd.trim();
    if (!src || busy) return;
    setCmdError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (/^repo\.new\b/i.test(src)) {
        const parsed = parseRepoNew(src);
        if (parsed.error) {
          setCmdError(parsed.error);
          return;
        }
        const r = await api<CodeRepoDto>("/code/repos", {
          method: "POST",
          body: JSON.stringify(parsed),
        });
        setCmd("");
        setSelectedId(r.id);
        setNotice(`✓ 仓库 ${r.name} 已创建 · ${r.language} @ ${r.branch}`);
        await reloadRepos();
      } else if (/^file\.new\b/i.test(src)) {
        if (!selectedId) {
          setCmdError("请先选择一个仓库");
          return;
        }
        const parsed = parseFileNew(src);
        if (parsed.error) {
          setCmdError(parsed.error);
          return;
        }
        const f = await api<CodeFileDetailDto>(`/code/repos/${selectedId}/files`, {
          method: "POST",
          body: JSON.stringify({ path: parsed.path, content: "" }),
        });
        setCmd("");
        setNotice(`✓ ${f.path} 已创建`);
        setDetail(f);
        setDraft("");
        await Promise.all([loadFiles(selectedId), reloadRepos()]);
      } else {
        setCmdError("可用命令：repo.new <name> [language] [描述] · file.new <path>");
      }
    } catch (e) {
      setCmdError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveFile = async () => {
    if (!selectedId || !detail || busy) return;
    setBusy(true);
    try {
      const d = await api<CodeFileDetailDto>(
        `/code/repos/${selectedId}/files/${detail.id}`,
        { method: "PATCH", body: JSON.stringify({ content: draft }) },
      );
      setDetail(d);
      setDraft(d.content);
      setNotice(`✓ ${d.path} 已保存`);
      await Promise.all([loadFiles(selectedId), reloadRepos()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 上传文本文件：同路径存在则确认后覆盖，否则新建 */
  const upload = async (file: File | undefined) => {
    if (!selectedId || !file || busy) return;
    setNotice(null);
    setError(null);
    if (!isTextFile(file)) {
      setError("一期仅支持文本类代码文件（.ts/.js/.json/.md/.go/.py/.sh…）");
      return;
    }
    setBusy(true);
    try {
      const content = await file.text();
      const path = file.webkitRelativePath || file.name;
      const existing = files.find((f) => f.path === path);
      if (existing && !window.confirm(`覆盖 ${path}？`)) return;

      const d = existing
        ? await api<CodeFileDetailDto>(`/code/repos/${selectedId}/files/${existing.id}`, {
            method: "PATCH",
            body: JSON.stringify({ content }),
          })
        : await api<CodeFileDetailDto>(`/code/repos/${selectedId}/files`, {
            method: "POST",
            body: JSON.stringify({ path, content }),
          });
      setDetail(d);
      setDraft(d.content);
      setNotice(`✓ ${existing ? "已覆盖" : "已上传"} ${d.path}`);
      await Promise.all([loadFiles(selectedId), reloadRepos()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const download = (d: CodeFileDetailDto) => {
    const name = d.path.split("/").pop() || d.path;
    const url = URL.createObjectURL(new Blob([d.content], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    setNotice(`⤓ ${d.path} 已下载`);
  };

  const removeRepo = async () => {
    if (!selected || !window.confirm(`删除仓库 ${selected.name} 及其全部文件？`)) return;
    try {
      await api(`/code/repos/${selected.id}`, { method: "DELETE" });
      setSelectedId(null);
      setNotice(`✓ 仓库 ${selected.name} 已删除`);
      await reloadRepos();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeFile = async (file: CodeFileDto) => {
    if (!selectedId || !window.confirm(`删除文件 ${file.path}？`)) return;
    try {
      await api(`/code/repos/${selectedId}/files/${file.id}`, { method: "DELETE" });
      if (detail?.id === file.id) {
        setDetail(null);
        setDraft("");
      }
      setNotice(`✓ 已删除 ${file.path}`);
      await Promise.all([loadFiles(selectedId), reloadRepos()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const copyPush = async () => {
    if (!selected) return;
    const cmdText = `wb push ./dist --to ${selected.name}`;
    try {
      await navigator.clipboard.writeText(cmdText);
      setNotice(`✓ 已复制：${cmdText}`);
    } catch {
      setNotice(cmdText);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[12px] text-tx3">
        ⠋ 读取 ~/code/repos…
      </div>
    );
  }

  return (
    <div className="mx-auto w-[min(1000px,96%)] py-8 font-mono">
      {/* 标题栏 */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs text-tx3">~/code/repos · 代码管理</span>
          <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-tx3">
            {repos.length} repositories
          </span>
          {!canWrite && (
            <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-warn">
              read-only
            </span>
          )}
        </div>
        <span className="text-[10px] text-tx3">本期：上传 / 下载 / 在线查看 · 后期对标 git</span>
      </div>

      {/* 命令栏 */}
      {canWrite ? (
        <form
          className="mb-4 rounded-md border border-dashed border-line px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submitCmd();
          }}
        >
          <div className="flex items-center gap-2 text-[12px]">
            <span className="text-acc">▸</span>
            <input
              className="min-w-0 flex-1 bg-transparent text-tx outline-none placeholder:text-tx3"
              placeholder="repo.new ai-workbench typescript AI-first 个人工作台   /   file.new src/main.ts"
              value={cmd}
              onChange={(e) => {
                setCmd(e.target.value);
                setCmdError(null);
              }}
            />
            <button
              className="rounded border border-line px-2 py-0.5 text-[10px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
              type="submit"
              disabled={busy || !cmd.trim()}
            >
              {busy ? "⠋ 执行中" : "⏎ 执行"}
            </button>
          </div>
          <div className="mt-1 text-[10px] text-tx3">
            // 一行命令代替表单 · repo.new 建仓库 · 选中仓库后 file.new 建空文件
          </div>
          {cmdError && <div className="mt-1 text-[11px] text-err">✗ {cmdError}</div>}
        </form>
      ) : (
        <div className="mb-4 rounded-md border border-dashed border-line px-3 py-2 text-[11px] text-tx3">
          // read-only · owner 可创建/上传/编辑/删除仓库与文件
        </div>
      )}

      {notice && <div className="mb-3 text-[11px] text-acc">{notice}</div>}
      {error && (
        <div className="mb-3 rounded border border-err/50 bg-bg1 px-3 py-2 text-[12px] text-err">
          ✗ {error}
        </div>
      )}

      {/* 仓库卡片 */}
      {repos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-4 py-12 text-center text-[12px] text-tx3">
          {canWrite
            ? "// 还没有仓库 —— repo.new ai-workbench typescript AI-first 工作台"
            : "// 当前没有可查看的仓库"}
        </div>
      ) : (
        <div className="mb-4 grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5">
          {repos.map((r) => {
            const on = r.id === selectedId;
            return (
              <button
                key={r.id}
                className={`relative rounded-md border p-3 text-left transition-colors ${
                  on
                    ? "border-acc bg-bg2"
                    : "border-line bg-bg1 hover:border-acc hover:bg-bg2"
                }`}
                onClick={() => setSelectedId(r.id)}
              >
                <div className="text-[10px] uppercase tracking-wider text-tx3">{r.language}</div>
                <div className={`mt-1 truncate text-[13px] ${on ? "text-acc" : "text-tx"}`}>
                  {on ? "▸" : "·"} {r.name}
                </div>
                <div className="mt-1 text-[10.5px] text-tx2">● {r.branch} · clean</div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-tx3">
                  <span>
                    {r.fileCount} files · {humanSize(r.sizeBytes)}
                  </span>
                  <span>{mmdd(r.updatedAt)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <>
          {/* 仓库头 */}
          <div className="mb-3 rounded-lg border border-line bg-bg1">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-[11px] text-tx3">
              <span className="text-acc">▸</span>
              <span className="text-tx">~/code/{selected.name}</span>
              <span>● {selected.branch}</span>
              <span>{selected.fileCount} files</span>
              <span className="ml-auto">{mmdd(selected.updatedAt)}</span>
              {canWrite && (
                <>
                  <button
                    className="rounded border border-line px-1.5 py-0.5 text-[10px] hover:border-acc hover:text-acc"
                    onClick={() => void copyPush()}
                    title="复制上传命令"
                  >
                    ⧉ push
                  </button>
                  <button
                    className="rounded border border-line px-1.5 py-0.5 text-[10px] hover:border-err hover:text-err"
                    onClick={() => void removeRepo()}
                  >
                    ✗ 删除仓库
                  </button>
                </>
              )}
            </div>
            <div className="px-3 py-2">
              <div className="text-[13px] text-tx">{selected.description || "// 暂无描述"}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-tx3">
                <button
                  className="rounded border border-line px-2 py-0.5 text-[10px] text-tx2 hover:border-acc hover:text-acc"
                  onClick={() => document.getElementById("code-file-input")?.click()}
                  disabled={!canWrite || busy}
                  hidden={!canWrite}
                  title="上传文本代码文件"
                >
                  ⤒ 上传文件
                </button>
                {canWrite && (
                  <input
                    id="code-file-input"
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      void upload(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                )}
                <span>{selected.fileCount} files</span>
                <span>{humanSize(selected.sizeBytes)}</span>
                <span className="ml-auto">updated {mmdd(selected.updatedAt)}</span>
              </div>
            </div>
          </div>

          {/* 文件树 */}
          <div className="overflow-hidden rounded-lg border border-line bg-bg1">
            <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[11px] text-tx3">
              <span>~/code/{selected.name}/</span>
              <span>{filesLoading ? "⠋ 读取中" : `${files.length} files`}</span>
            </div>
            {files.length === 0 ? (
              <div className="px-4 py-10 text-center text-[12px] text-tx3">
                {canWrite
                  ? "// 仓库为空 —— file.new src/main.ts 或点「⤒ 上传文件」"
                  : "// 该仓库还没有文件"}
              </div>
            ) : (
              <div className="max-h-[280px] overflow-y-auto py-1">
                {files.map((f, i) => (
                  <div
                    key={f.id}
                    className={`group flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12px] ${
                      detail?.id === f.id ? "bg-bg2" : "hover:bg-bg2"
                    }`}
                    onClick={() => void openFile(f)}
                  >
                    <span className="flex-none text-tx3">
                      {i === files.length - 1 ? "└──" : "├──"}
                    </span>
                    <span
                      className={`min-w-0 flex-1 truncate ${
                        detail?.id === f.id ? "text-acc" : "text-tx"
                      }`}
                    >
                      {f.path}
                    </span>
                    <span className="flex-none text-[10px] text-tx3">
                      {humanSize(f.size)} · {mmdd(f.updatedAt)}
                    </span>
                    {canWrite && (
                      <button
                        className="invisible flex-none text-[10px] text-tx3 hover:text-err group-hover:visible"
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeFile(f);
                        }}
                      >
                        ✗
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 文件内容 */}
          {detail && (
            <div className="mt-3 overflow-hidden rounded-lg border border-line bg-bg1">
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-[11px] text-tx3">
                <span className="text-acc">▸</span>
                <span className="min-w-0 truncate text-tx">
                  ~/code/{selected.name}/{detail.path}
                </span>
                <span>{humanSize(detail.size)}</span>
                {!canWrite && <span className="text-warn">read-only</span>}
                <button
                  className="rounded border border-line px-1.5 py-0.5 text-[10px] hover:border-acc hover:text-acc"
                  onClick={() => download(detail)}
                >
                  ⤓ 下载
                </button>
                <button
                  className="ml-auto rounded border border-line px-1.5 py-0.5 text-[10px] hover:border-acc hover:text-acc"
                  onClick={() => {
                    setDetail(null);
                    setDraft("");
                  }}
                >
                  × 关闭
                </button>
              </div>

              {canWrite ? (
                <>
                  <textarea
                    className="h-72 w-full resize-y bg-transparent px-3 py-2 text-[12.5px] leading-relaxed text-tx outline-none placeholder:text-tx3"
                    value={draft}
                    placeholder="// 空文件 —— 直接输入代码，然后 ⏎ 保存"
                    onChange={(e) => setDraft(e.target.value)}
                    spellCheck={false}
                  />
                  <div className="flex items-center gap-3 border-t border-line px-3 py-2 text-[10px] text-tx3">
                    <button
                      className="rounded border border-line px-2.5 py-1 text-[10.5px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
                      onClick={() => void saveFile()}
                      disabled={busy || draft === detail.content}
                    >
                      {busy ? "⠋ 保存中" : "⏎ 保存"}
                    </button>
                    <button
                      className="rounded border border-line px-2.5 py-1 text-[10.5px] text-tx3 hover:border-acc hover:text-acc"
                      onClick={() => setDraft(detail.content)}
                      disabled={draft === detail.content}
                    >
                      ↺ 还原
                    </button>
                    <span className="ml-auto">
                      {draft.length} chars · {draft === detail.content ? "已保存" : "有未保存改动"}
                    </span>
                  </div>
                </>
              ) : (
                <div className="max-h-[460px] overflow-auto whitespace-pre px-3 py-2 text-[12.5px] leading-relaxed text-tx2">
                  {detail.content || "// 空文件"}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
