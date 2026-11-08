import { useEffect, useRef, useState } from "react";
import type { ResumeDto, ResumeImportResult } from "@aiwb/shared";
import { api } from "../../lib/api";
import ResumeCard from "./ResumeCard";

/** 带行号的 JSON 编辑器：行号栏与文本框同字号/行高，滚动同步，方便定位报错行 */
function LineNumberedEditor({
  value,
  onChange,
  height = 380,
}: {
  value: string;
  onChange: (v: string) => void;
  height?: number;
}) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const lineCount = Math.max(1, value.split("\n").length);

  return (
    <div
      className="flex overflow-hidden rounded border border-line bg-bg focus-within:border-acc"
      style={{ height }}
    >
      <div
        ref={gutterRef}
        className="h-full w-11 flex-none select-none overflow-hidden border-r border-line bg-bg1 py-3 text-right font-mono text-[12px] leading-5 text-tx3"
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className="pr-2">
            {i + 1}
          </div>
        ))}
      </div>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={() => {
          // 只同步纵向：横向各自滚动，避免长行把行号错位
          if (gutterRef.current && taRef.current) gutterRef.current.scrollTop = taRef.current.scrollTop;
        }}
        wrap="off"
        spellCheck={false}
        className="h-full flex-1 resize-none overflow-auto whitespace-pre bg-transparent px-3 py-3 font-mono text-[12px] leading-5 text-tx outline-none"
      />
    </div>
  );
}

/** 个人简历面板：导入(文本/PDF/Word) → 解析 → 文档卡渲染 */
export default function ResumePanel() {
  const [data, setData] = useState<ResumeDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 导入面板
  const [importing, setImporting] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ResumeImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<ResumeDto>("/resume/me")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const startEdit = () => {
    if (!data) return;
    setDraft(JSON.stringify(data.profile, null, 2));
    setEditError(null);
    setNotice(null);
    setEditing(true);
  };

  /** 上传文件 → 后端抽取 + 解析（不落库） */
  const parseFile = async (file: File) => {
    if (busy) return;
    setBusy(true);
    setImportError(null);
    setPreview(null);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await api<ResumeImportResult>("/resume/import", { method: "POST", body: fd });
      setPreview(result);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 粘贴文本 → 后端解析（不落库） */
  const parsePasted = async () => {
    if (busy || !pasteText.trim()) return;
    setBusy(true);
    setImportError(null);
    setPreview(null);
    setNotice(null);
    try {
      const result = await api<ResumeImportResult>("/resume/parse", {
        method: "POST",
        body: JSON.stringify({ text: pasteText }),
      });
      setPreview(result);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 确认预览 → 写入档案卡，由终端档案卡渲染 */
  const applyPreview = async () => {
    if (!preview || saving) return;
    setSaving(true);
    setImportError(null);
    try {
      const next = await api<ResumeDto>("/resume/me", {
        method: "PUT",
        body: JSON.stringify({ profile: preview.profile }),
      });
      setData(next);
      setPreview(null);
      setPasteText("");
      setImporting(false);
      setNotice(`✓ 已导入并渲染 · 来源 ${preview.source} · ${preview.chars} 字符`);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // V8 报错带 position 或 line，换算成编辑器的行号，配合行号栏直接定位
      const lineMatch = msg.match(/line (\d+)/i);
      const posMatch = msg.match(/position (\d+)/i);
      const line = lineMatch
        ? Number(lineMatch[1])
        : posMatch
          ? draft.slice(0, Math.min(Number(posMatch[1]), draft.length)).split("\n").length
          : null;
      setEditError(`${line ? `第 ${line} 行 · ` : ""}JSON 解析失败：${msg}`);
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setEditError("profile.json 顶层必须是对象");
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      const next = await api<ResumeDto>("/resume/me", {
        method: "PUT",
        body: JSON.stringify({ profile: parsed }),
      });
      setData(next);
      setEditing(false);
      setNotice("✓ 已写入 ~/me/profile.json");
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(`${location.origin}/p/${data.username}`);
      setNotice("✓ 公开链接已复制");
    } catch {
      setNotice(`公开链接：${location.origin}/p/${data.username}`);
    }
  };

  if (error) {
    return (
      <div className="mx-auto w-[min(900px,96%)] py-8 font-mono">
        <div className="rounded-lg border border-err/50 bg-bg1 px-4 py-3 text-[12px] text-err">
          ✗ 读取简历失败：{error}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[12px] text-tx3">
        ⠋ 读取 ~/me/profile.json…
      </div>
    );
  }

  return (
    <div className="mx-auto w-[min(900px,96%)] py-8 font-mono">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs text-tx3">个人简历</span>
          <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-tx3">
            {data.updatedAt === null
              ? "empty"
              : `updated ${new Date(data.updatedAt).toLocaleTimeString("zh-CN", { hour12: false })}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded border border-line px-2.5 py-1 text-[11px] text-tx2 hover:border-acc hover:text-acc"
            onClick={() => void copyLink()}
            title="复制游客可访问的公开只读链接"
          >
            ⧉ 公开链接
          </button>
          {data.canEdit && (
            <button
              className="rounded border border-line px-2.5 py-1 text-[11px] text-tx2 hover:border-acc hover:text-acc"
              onClick={() => {
                const next = !importing;
                setImporting(next);
                setPreview(null);
                setImportError(null);
                if (next) setEditing(false);
              }}
              title="从 PDF / Word / 文本导入简历"
            >
              {importing ? "× 收起导入" : "⇪ 导入简历"}
            </button>
          )}
          {data.canEdit && (
            <button
              className="rounded border border-line px-2.5 py-1 text-[11px] text-tx2 hover:border-acc hover:text-acc"
              onClick={() => {
                if (editing) {
                  setEditing(false);
                } else {
                  setImporting(false);
                  setPreview(null);
                  startEdit();
                }
              }}
            >
              {editing ? "× 收起编辑" : "✎ 编辑"}
            </button>
          )}
        </div>
      </div>

      {notice && <div className="mb-3 text-[11px] text-acc">{notice}</div>}

      {/* 导入面板：文件 / 粘贴文本 → 解析预览 → 写入并渲染 */}
      {importing && (
        <div className="mb-4 rounded-lg border border-line bg-bg1 p-4 font-mono text-[12px]">
          <div className="mb-3 flex items-center justify-between text-[11px] text-tx3">
            <span className="truncate">导入简历 · PDF / Word / 文本</span>
            <button
              className="flex-none hover:text-err"
              onClick={() => {
                setImporting(false);
                setPreview(null);
                setImportError(null);
              }}
            >
              ✕
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,.markdown"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void parseFile(f);
              }}
            />
            <button
              className="rounded border border-line px-2.5 py-1 text-[11px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              ⇪ 选择文件
            </button>
            <span className="text-[10px] text-tx3">.pdf / .docx / .txt / .md · ≤10MB</span>
            {busy && <span className="text-[10px] text-acc">⠋ 解析中…</span>}
          </div>

          <div className="my-3 text-[10px] text-tx3">// 或者直接粘贴简历文本</div>
          <textarea
            className="h-[120px] w-full resize-y border border-line bg-bg p-2.5 text-[12px] leading-relaxed text-tx outline-none focus:border-acc"
            placeholder="粘贴简历内容，例如：姓名 / 联系方式 / 工作经历 / 项目经历 / 教育经历…"
            value={pasteText}
            onChange={(e) => {
              setPasteText(e.target.value);
              setPreview(null);
            }}
            spellCheck={false}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              className="rounded border border-line px-3 py-1 text-[11px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
              onClick={() => void parsePasted()}
              disabled={busy || !pasteText.trim()}
            >
              {busy ? "⠋ 解析中" : "▸ 解析文本"}
            </button>
            {importError && <span className="text-[11px] text-err">✗ {importError}</span>}
          </div>

          {preview && (
            <div className="mt-3 rounded border border-acc/40 bg-bg p-3">
              <div className="text-[10px] text-acc">
                ✓ 解析完成 · 来源 {preview.source} · {preview.chars} 字符
              </div>
              <div className="mt-1 text-[13px] font-bold text-tx">
                {preview.profile.basics.name || data.username}
                {preview.profile.basics.headline && (
                  <span className="font-normal text-tx2">
                    <span className="text-tx3"> — </span>
                    {preview.profile.basics.headline}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-tx3">
                工作经历 {preview.profile.experience.length} · 教育 {preview.profile.education.length} ·
                技能组 {preview.profile.skills.length} · 项目 {preview.profile.projects.length}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button
                  className="rounded border border-acc/60 px-3 py-1 text-[11px] text-acc hover:bg-acc/10 disabled:opacity-40"
                  onClick={() => void applyPreview()}
                  disabled={saving}
                >
                  {saving ? "⠋ 写入中" : ":wq 写入并渲染"}
                </button>
                <button
                  className="rounded border border-line px-3 py-1 text-[11px] text-tx2 hover:border-err hover:text-err"
                  onClick={() => setPreview(null)}
                  disabled={saving}
                >
                  × 放弃
                </button>
                <span className="text-[10px] text-tx3">// 写入会覆盖当前档案卡</span>
              </div>
            </div>
          )}
        </div>
      )}

      <ResumeCard data={data} />

      {editing && (
        <div className="mt-4 rounded-lg border border-line bg-bg1 p-4 font-mono text-[12px]">
          <div className="mb-2 flex items-center justify-between text-[11px] text-tx3">
            <span className="truncate">编辑档案卡数据</span>
            <span className="flex-none text-tx3">JSON</span>
          </div>
          <LineNumberedEditor value={draft} onChange={setDraft} />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              className="rounded border border-line px-3 py-1 text-[11px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? "⠋ 写入中" : ":wq 保存"}
            </button>
            <button
              className="rounded border border-line px-3 py-1 text-[11px] text-tx2 hover:border-err hover:text-err"
              onClick={() => {
                setEditing(false);
                setEditError(null);
              }}
              disabled={saving}
            >
              :q! 取消
            </button>
            {editError && <span className="text-[11px] text-err">✗ {editError}</span>}
          </div>
          <div className="mt-2 text-[10px] leading-relaxed text-tx3">
            // 字段：basics.name / headline / location / experienceYears / status / summary / email /
            // website · experience[] · education[] · skills[] · projects[]
          </div>
        </div>
      )}
    </div>
  );
}
