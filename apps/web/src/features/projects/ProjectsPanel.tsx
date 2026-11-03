import { useCallback, useEffect, useState } from "react";
import type {
  ProjectDocDetailDto,
  ProjectDocDto,
  ProjectDto,
  ProjectStatus,
} from "@aiwb/shared";
import { api } from "../../lib/api";
import { useAuthStore } from "../../stores/auth";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "进行中",
  paused: "暂停",
  done: "完结",
};

const STATUS_CLASS: Record<ProjectStatus, string> = {
  active: "border-acc/50 text-acc",
  paused: "border-warn/50 text-warn",
  done: "border-line text-tx3",
};

function mmdd(ts: number) {
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

/** project.new <name> [描述] [#active|#paused|#done] → 名称 + 描述 + 状态 */
function parseProjectNew(raw: string) {
  const src = raw.replace(/^project\.new\s*/i, "").trim();
  if (!src) return { error: "用法：project.new <name> [描述] [#status]" };

  let status: ProjectStatus | undefined;
  const statusMatch = src.match(/#(active|paused|done)\b/i);
  let rest = src;
  if (statusMatch) {
    status = statusMatch[1].toLowerCase() as ProjectStatus;
    rest = rest.replace(statusMatch[0], " ");
  }

  const tokens = rest.trim().split(/\s+/);
  const name = tokens[0] ?? "";
  const title = tokens.slice(1).join(" ").trim();
  if (!name) return { error: "缺少项目名，如 project.new ai-workbench AI-first 工作台" };
  return { name, title: title || undefined, status };
}

/** doc.new <文件名> → 在当前项目下新建一篇空文档 */
function parseDocNew(raw: string) {
  const title = raw.replace(/^doc\.new\s*/i, "").trim();
  if (!title) return { error: "用法：doc.new <文件名>（如 需求准备.md）" };
  return { title };
}

/** 项目管理：项目列表 + 文档树 + 终端式 Markdown 编辑 */
export default function ProjectsPanel() {
  const role = useAuthStore((s) => s.user?.role ?? "guest");
  // 与原型 ACL 一致：owner rw，member ro；服务端 projects:read / projects:write 兜底
  const canWrite = role === "owner";

  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [docs, setDocs] = useState<ProjectDocDto[]>([]);
  const [detail, setDetail] = useState<ProjectDocDetailDto | null>(null);
  const [draft, setDraft] = useState("");

  const [loading, setLoading] = useState(true);
  const [docsLoading, setDocsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cmd, setCmd] = useState("");
  const [cmdError, setCmdError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  const reloadProjects = useCallback(async () => {
    try {
      const list = await api<ProjectDto[]>("/projects");
      setProjects(list);
      setSelectedId((prev) =>
        prev && list.some((p) => p.id === prev) ? prev : (list[0]?.id ?? null),
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDocs = useCallback(async (projectId: string) => {
    setDocsLoading(true);
    try {
      setDocs(await api<ProjectDocDto[]>(`/projects/${projectId}/docs`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDocsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadProjects();
  }, [reloadProjects]);

  useEffect(() => {
    setDetail(null);
    setDraft("");
    if (!selectedId) {
      setDocs([]);
      return;
    }
    void loadDocs(selectedId);
  }, [selectedId, loadDocs]);

  const openDoc = async (doc: ProjectDocDto) => {
    if (!selectedId) return;
    try {
      const d = await api<ProjectDocDetailDto>(`/projects/${selectedId}/docs/${doc.id}`);
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
      if (/^project\.new\b/i.test(src)) {
        const parsed = parseProjectNew(src);
        if (parsed.error) {
          setCmdError(parsed.error);
          return;
        }
        const p = await api<ProjectDto>("/projects", {
          method: "POST",
          body: JSON.stringify({ name: parsed.name, title: parsed.title, status: parsed.status }),
        });
        setCmd("");
        setSelectedId(p.id);
        setNotice(`✓ 项目 ${p.name} 已创建 · 现在可以 doc.new 添加文档`);
        await reloadProjects();
      } else if (/^doc\.new\b/i.test(src)) {
        if (!selectedId) {
          setCmdError("请先选择一个项目");
          return;
        }
        const parsed = parseDocNew(src);
        if (parsed.error) {
          setCmdError(parsed.error);
          return;
        }
        const d = await api<ProjectDocDetailDto>(`/projects/${selectedId}/docs`, {
          method: "POST",
          body: JSON.stringify({ title: parsed.title, content: "" }),
        });
        setCmd("");
        setNotice(`✓ ${d.path} 已创建 · v${d.version}`);
        setDetail(d);
        setDraft("");
        await Promise.all([loadDocs(selectedId), reloadProjects()]);
      } else {
        setCmdError("可用命令：project.new <name> [描述] · doc.new <文件名>");
      }
    } catch (e) {
      setCmdError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveDoc = async () => {
    if (!selectedId || !detail || busy) return;
    setBusy(true);
    try {
      const d = await api<ProjectDocDetailDto>(
        `/projects/${selectedId}/docs/${detail.id}`,
        { method: "PATCH", body: JSON.stringify({ content: draft }) },
      );
      setDetail(d);
      setDraft(d.content);
      setNotice(`✓ ${d.title} 已保存 · v${d.version}`);
      await Promise.all([loadDocs(selectedId), reloadProjects()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: ProjectStatus) => {
    if (!selectedId) return;
    try {
      const p = await api<ProjectDto>(`/projects/${selectedId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setProjects((prev) => prev.map((x) => (x.id === p.id ? p : x)));
      setNotice(`✓ ${p.name} → ${STATUS_LABEL[p.status]}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeProject = async () => {
    if (!selected || !window.confirm(`删除项目 ${selected.name} 及其全部文档？`)) return;
    try {
      await api(`/projects/${selected.id}`, { method: "DELETE" });
      setSelectedId(null);
      setNotice(`✓ 项目 ${selected.name} 已删除`);
      await reloadProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeDoc = async (doc: ProjectDocDto) => {
    if (!selectedId || !window.confirm(`删除文档 ${doc.path}？`)) return;
    try {
      await api(`/projects/${selectedId}/docs/${doc.id}`, { method: "DELETE" });
      if (detail?.id === doc.id) {
        setDetail(null);
        setDraft("");
      }
      setNotice(`✓ 已删除 ${doc.title}`);
      await Promise.all([loadDocs(selectedId), reloadProjects()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[12px] text-tx3">
        ⠋ 读取 ~/projects…
      </div>
    );
  }

  return (
    <div className="mx-auto w-[min(1000px,96%)] py-8 font-mono">
      {/* 标题栏 */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs text-tx3">~/projects · 项目管理</span>
          <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-tx3">
            {projects.length} projects
          </span>
          {!canWrite && (
            <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-warn">
              read-only
            </span>
          )}
        </div>
        <span className="text-[10px] text-tx3">项目文档独立于知识库 · 后期对标 git</span>
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
              placeholder="project.new ai-workbench AI-first 个人工作台   /   doc.new 需求准备.md"
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
            // 一行命令代替表单 · project.new 建项目 · 选中项目后 doc.new 建空文档
          </div>
          {cmdError && <div className="mt-1 text-[11px] text-err">✗ {cmdError}</div>}
        </form>
      ) : (
        <div className="mb-4 rounded-md border border-dashed border-line px-3 py-2 text-[11px] text-tx3">
          // read-only · owner 可创建/编辑/删除项目与文档
        </div>
      )}

      {notice && <div className="mb-3 text-[11px] text-acc">{notice}</div>}
      {error && (
        <div className="mb-3 rounded border border-err/50 bg-bg1 px-3 py-2 text-[12px] text-err">
          ✗ {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[280px_minmax(0,1fr)]">
        {/* 项目列表 */}
        <div className="overflow-hidden rounded-lg border border-line bg-bg1">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[11px] text-tx3">
            <span>~/projects</span>
            <span>{projects.length} repos</span>
          </div>
          {projects.length === 0 ? (
            <div className="px-4 py-10 text-center text-[12px] text-tx3">
              {canWrite
                ? "// 还没有项目 —— project.new ai-workbench AI-first 工作台"
                : "// 当前没有可查看的项目"}
            </div>
          ) : (
            <div className="max-h-[520px] overflow-y-auto">
              {projects.map((p) => {
                const on = p.id === selectedId;
                return (
                  <button
                    key={p.id}
                    className={`block w-full border-b border-line px-3 py-2 text-left transition-colors ${
                      on ? "bg-bg2" : "hover:bg-bg2"
                    }`}
                    onClick={() => setSelectedId(p.id)}
                  >
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className={on ? "text-acc" : "text-tx3"}>{on ? "▸" : "·"}</span>
                      <span className={`min-w-0 flex-1 truncate ${on ? "text-acc" : "text-tx"}`}>
                        {p.name}
                      </span>
                      <span
                        className={`flex-none rounded border px-1 text-[9.5px] ${STATUS_CLASS[p.status]}`}
                      >
                        {STATUS_LABEL[p.status]}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[10.5px] text-tx2">
                      {p.title || "// 暂无描述"}
                    </div>
                    <div className="mt-0.5 text-[10px] text-tx3">
                      docs {p.docCount} · {mmdd(p.updatedAt)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 项目详情 + 文档树 + 编辑 */}
        <div className="min-w-0">
          {!selected ? (
            <div className="flex h-[240px] items-center justify-center rounded-lg border border-dashed border-line text-[12px] text-tx3">
              // 从左侧选择一个项目
            </div>
          ) : (
            <>
              <div className="mb-3 rounded-lg border border-line bg-bg1">
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-[11px] text-tx3">
                  <span className="text-acc">▸</span>
                  <span className="text-tx">~/projects/{selected.name}</span>
                  <span>{selected.docCount} docs</span>
                  <span className="ml-auto">{mmdd(selected.updatedAt)}</span>
                  {canWrite && (
                    <button
                      className="rounded border border-line px-1.5 py-0.5 text-[10px] hover:border-err hover:text-err"
                      onClick={() => void removeProject()}
                    >
                      ✗ 删除项目
                    </button>
                  )}
                </div>
                <div className="px-3 py-2">
                  <div className="text-[13px] text-tx">{selected.title || "// 暂无描述"}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className="text-tx3">status:</span>
                    {(["active", "paused", "done"] as ProjectStatus[]).map((s) =>
                      canWrite ? (
                        <button
                          key={s}
                          className={`rounded border px-1.5 py-0.5 ${
                            selected.status === s
                              ? STATUS_CLASS[s]
                              : "border-line text-tx3 hover:border-acc hover:text-acc"
                          }`}
                          onClick={() => void setStatus(s)}
                        >
                          #{s}
                        </button>
                      ) : (
                        <span
                          key={s}
                          className={`rounded border px-1.5 py-0.5 ${
                            selected.status === s ? STATUS_CLASS[s] : "border-line text-tx3"
                          }`}
                        >
                          #{s}
                        </span>
                      ),
                    )}
                    <span className="ml-auto text-tx3">
                      created {mmdd(selected.createdAt)}
                    </span>
                  </div>
                </div>
              </div>

              {/* 文档树 */}
              <div className="overflow-hidden rounded-lg border border-line bg-bg1">
                <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[11px] text-tx3">
                  <span>~/projects/{selected.name}/docs</span>
                  <span>{docsLoading ? "⠋ 读取中" : `${docs.length} files`}</span>
                </div>
                {docs.length === 0 ? (
                  <div className="px-4 py-10 text-center text-[12px] text-tx3">
                    {canWrite
                      ? "// 还没有文档 —— doc.new 需求准备.md"
                      : "// 该项目还没有文档"}
                  </div>
                ) : (
                  <div className="max-h-[280px] overflow-y-auto py-1">
                    {docs.map((d, i) => (
                      <div
                        key={d.id}
                        className={`group flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12px] ${
                          detail?.id === d.id ? "bg-bg2" : "hover:bg-bg2"
                        }`}
                        onClick={() => void openDoc(d)}
                      >
                        <span className="flex-none text-tx3">
                          {i === docs.length - 1 ? "└──" : "├──"}
                        </span>
                        <span
                          className={`min-w-0 flex-1 truncate ${
                            detail?.id === d.id ? "text-acc" : "text-tx"
                          }`}
                        >
                          {d.title}
                        </span>
                        <span className="flex-none text-[10px] text-tx3">
                          {humanSize(d.size)} · v{d.version} · {mmdd(d.updatedAt)}
                        </span>
                        {canWrite && (
                          <button
                            className="invisible flex-none text-[10px] text-tx3 hover:text-err group-hover:visible"
                            onClick={(e) => {
                              e.stopPropagation();
                              void removeDoc(d);
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

              {/* 文档内容 */}
              {detail && (
                <div className="mt-3 overflow-hidden rounded-lg border border-line bg-bg1">
                  <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-[11px] text-tx3">
                    <span className="text-acc">▸</span>
                    <span className="min-w-0 truncate text-tx">{detail.path}</span>
                    <span>v{detail.version}</span>
                    <span>{humanSize(detail.size)}</span>
                    {!canWrite && <span className="text-warn">read-only</span>}
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
                        className="h-64 w-full resize-y bg-transparent px-3 py-2 text-[12.5px] leading-relaxed text-tx outline-none placeholder:text-tx3"
                        value={draft}
                        placeholder="// 空白文档 —— 直接输入 Markdown 正文，然后 ⏎ 保存"
                        onChange={(e) => setDraft(e.target.value)}
                      />
                      <div className="flex items-center gap-3 border-t border-line px-3 py-2 text-[10px] text-tx3">
                        <button
                          className="rounded border border-line px-2.5 py-1 text-[10.5px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
                          onClick={() => void saveDoc()}
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
                    <div className="max-h-[420px] overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 text-[12.5px] leading-relaxed text-tx2">
                      {detail.content || "// 空文档"}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
