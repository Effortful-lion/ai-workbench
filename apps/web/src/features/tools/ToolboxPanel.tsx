import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ToolboxItemDto, ToolboxKind } from "@aiwb/shared";
import { api } from "../../lib/api";
import { useAuthStore } from "../../stores/auth";
import ToolboxWall from "./ToolboxWall";

interface ParsedAlias {
  url?: string;
  name?: string;
  category?: string;
  desc?: string;
  error?: string;
}

/** alias.new <url> [#分类] [简介] [--name 别名] —— 一行命令替代完整表单 */
function parseAlias(raw: string): ParsedAlias {
  const src = raw.trim().replace(/^alias\.new\s*/i, "");
  if (!src) return { error: "命令为空" };
  const urlMatch = src.match(/https?:\/\/[^\s]+/i);
  if (!urlMatch) return { error: "缺少 http(s) 链接，如 alias.new https://cursor.sh #dev 代码编辑器" };

  let rest = src.replace(urlMatch[0], " ");
  let name: string | undefined;
  const nameFlag = rest.match(/--name\s+(\S+)/i);
  if (nameFlag) {
    name = nameFlag[1];
    rest = rest.replace(nameFlag[0], " ");
  }

  let category: string | undefined;
  const hash = rest.match(/#([^\s#]+)/);
  if (hash) {
    category = hash[1];
    rest = rest.replace(hash[0], " ");
  } else {
    const catFlag = rest.match(/--cat(?:egory)?\s+(\S+)/i);
    if (catFlag) {
      category = catFlag[1];
      rest = rest.replace(catFlag[0], " ");
    }
  }

  const desc = rest.replace(/\s+/g, " ").trim();
  return { url: urlMatch[0], name, category, desc: desc || undefined };
}

/** 工具分类：数据库 / 技能 / AI / 开发 / 设计 / 运维 / 办公 / 其他 */
const CATEGORIES = [
  { value: "db", label: "数据库 / DB" },
  { value: "skill", label: "技能 / Skills" },
  { value: "ai", label: "AI / 模型" },
  { value: "dev", label: "开发 / Dev" },
  { value: "design", label: "设计 / Design" },
  { value: "ops", label: "运维 / Ops" },
  { value: "office", label: "办公 / Office" },
  { value: "misc", label: "其他 / Misc" },
];

const MAX_FILE_MB = 50;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const inputCls =
  "flex-1 border-b border-line bg-transparent py-1 pl-2 text-tx outline-none placeholder:text-tx3 focus:border-acc";

/** 百宝箱：工具墙 + 表单（链接 / 文件）+ 可选命令模式 */
export default function ToolboxPanel() {
  const role = useAuthStore((s) => s.user?.role ?? "guest");
  // 与原型 ACL 一致：owner rw，member ro；服务端 tools:read / tools:write 兜底
  const canWrite = role === "owner";

  const [items, setItems] = useState<ToolboxItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 表单 / 命令两种录入方式
  const [showAdd, setShowAdd] = useState(false);
  const [entry, setEntry] = useState<"form" | "cmd">("form");
  const [mode, setMode] = useState<ToolboxKind>("link");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("misc");
  const [customCategory, setCustomCategory] = useState("");
  const [desc, setDesc] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 命令模式
  const [cmd, setCmd] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    api<ToolboxItemDto[]>("/toolbox/items")
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const finalCategory = category === "__custom" ? customCategory.trim() || "misc" : category;

  const closeAdd = () => {
    setShowAdd(false);
    setFormError(null);
    setAddError(null);
  };

  const pickFile = (f: File | null) => {
    setFile(f);
    setFormError(null);
    if (f && !name.trim()) setName(f.name.replace(/\.[^.]*$/, "").slice(0, 40));
  };

  const resetForm = () => {
    setName("");
    setUrl("");
    setDesc("");
    setFile(null);
    setCustomCategory("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const submitForm = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setFormError(null);
    setNotice(null);
    if (mode === "link" && !url.trim()) {
      setFormError("请填写链接地址");
      return;
    }
    if (mode === "file" && !file) {
      setFormError("请选择要上传的文件");
      return;
    }
    if (mode === "file" && file && file.size > MAX_FILE_MB * 1024 * 1024) {
      setFormError(`文件不能超过 ${MAX_FILE_MB}MB`);
      return;
    }

    setSaving(true);
    try {
      let item: ToolboxItemDto;
      if (mode === "link") {
        item = await api<ToolboxItemDto>("/toolbox/items", {
          method: "POST",
          body: JSON.stringify({
            url: url.trim(),
            name: name.trim() || undefined,
            category: finalCategory,
            desc: desc.trim() || undefined,
          }),
        });
      } else {
        const fd = new FormData();
        fd.append("file", file as File);
        if (name.trim()) fd.append("name", name.trim());
        fd.append("category", finalCategory);
        if (desc.trim()) fd.append("desc", desc.trim());
        item = await api<ToolboxItemDto>("/toolbox/items/upload", { method: "POST", body: fd });
      }
      setItems((prev) => [item, ...prev]);
      resetForm();
      setShowAdd(false);
      setNotice(
        `✓ alias.${item.name} #${item.category} 已加入（${item.kind === "file" ? "文件" : "链接"}）`,
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const addViaCommand = async (e: FormEvent) => {
    e.preventDefault();
    if (adding) return;
    const parsed = parseAlias(cmd);
    if (parsed.error || !parsed.url) {
      setAddError(parsed.error ?? "链接解析失败");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const item = await api<ToolboxItemDto>("/toolbox/items", {
        method: "POST",
        body: JSON.stringify(parsed),
      });
      setItems((prev) => [item, ...prev]);
      setCmd("");
      setShowAdd(false);
      setNotice(`✓ alias.${item.name} #${item.category} 已加入（链接）`);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  /** 先同步打开窗口，避免异步请求后被浏览器拦；再累计使用次数 */
  const open = (item: ToolboxItemDto) => {
    window.open(item.url, "_blank", "noopener,noreferrer");
    void api<{ useCount: number }>(`/toolbox/items/${item.id}/use`, { method: "POST" })
      .then(({ useCount }) =>
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, useCount } : i))),
      )
      .catch(() => {
        /* 计数失败不影响打开 */
      });
  };

  const remove = async (item: ToolboxItemDto) => {
    if (!window.confirm(`从百宝箱移除 alias.${item.name}？`)) return;
    try {
      await api(`/toolbox/items/${item.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setNotice(`✓ 已移除 alias.${item.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const copyLink = async () => {
    const username = useAuthStore.getState().user?.username;
    if (!username) return;
    try {
      await navigator.clipboard.writeText(`${location.origin}/t/${username}`);
      setNotice("✓ 公开链接已复制");
    } catch {
      setNotice(`公开链接：${location.origin}/t/${username}`);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[12px] text-tx3">
        ⠋ 读取 ~/tools/aliases…
      </div>
    );
  }

  return (
    <div className="mx-auto w-[min(900px,96%)] py-8 font-mono">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs text-tx3">~/tools · 百宝箱</span>
          <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-tx3">
            {items.length} aliases
          </span>
          {!canWrite && (
            <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-warn">
              read-only
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canWrite && (
            <button
              className="rounded border border-line px-2.5 py-1 text-[11px] text-tx2 hover:border-acc hover:text-acc"
              onClick={() => {
                setFormError(null);
                setAddError(null);
                setShowAdd(true);
              }}
            >
              + 添加工具
            </button>
          )}
          <button
            className="rounded border border-line px-2.5 py-1 text-[11px] text-tx2 hover:border-acc hover:text-acc"
            onClick={() => void copyLink()}
            title="复制游客可访问的公开只读链接"
          >
            ⧉ 公开链接
          </button>
        </div>
      </div>

      {!canWrite && (
        <div className="mb-4 rounded-md border border-dashed border-line px-3 py-2 text-[11px] text-tx3">
          // read-only · owner 可新增/删除；点击卡片打开工具，使用次数会自动累计
        </div>
      )}

      {canWrite && showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeAdd();
          }}
        >
          <div className="w-[min(620px,96%)] overflow-hidden rounded-lg border border-line bg-bg1 shadow-2xl">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[11px]">
              <span className="text-acc">▸</span>
              <span className="text-tx2">alias.new</span>
              <span className="text-tx3">// 添加工具</span>
              <div className="ml-auto flex items-center gap-1">
                <button
                  className={`rounded border px-1.5 py-0.5 text-[10px] ${
                    entry === "form" ? "border-acc text-acc" : "border-line text-tx3 hover:text-tx2"
                  }`}
                  onClick={() => setEntry("form")}
                >
                  ▤ 表单
                </button>
                <button
                  className={`rounded border px-1.5 py-0.5 text-[10px] ${
                    entry === "cmd" ? "border-acc text-acc" : "border-line text-tx3 hover:text-tx2"
                  }`}
                  onClick={() => setEntry("cmd")}
                >
                  ⌘ 命令
                </button>
                <button
                  className="ml-2 rounded border border-line px-1.5 py-0.5 text-[10px] text-tx3 hover:border-err hover:text-err"
                  onClick={closeAdd}
                  title="关闭"
                >
                  ✕
                </button>
              </div>
            </div>

            {entry === "form" ? (
              <form className="px-4 py-3" onSubmit={submitForm}>
              <div className="flex items-center gap-2 text-[12px]">
                <span className="text-tx3">kind:</span>
                <button
                  className={`rounded border px-2 py-0.5 text-[10px] ${
                    mode === "link" ? "border-acc text-acc" : "border-line text-tx3 hover:text-tx2"
                  }`}
                  type="button"
                  onClick={() => setMode("link")}
                >
                  ⌁ 链接
                </button>
                <button
                  className={`rounded border px-2 py-0.5 text-[10px] ${
                    mode === "file" ? "border-acc text-acc" : "border-line text-tx3 hover:text-tx2"
                  }`}
                  type="button"
                  onClick={() => setMode("file")}
                >
                  ▤ 文件
                </button>
                <span className="ml-auto text-[10px] text-tx3">
                  {mode === "link" ? "外链地址，如官网 / 文档" : "二进制 / 安装包 / 压缩包 / 技能包"}
                </span>
              </div>

              <div className="mt-2 space-y-2">
                <label className="flex items-center gap-4">
                  <span className="w-16 text-tx3">name:</span>
                  <input
                    className={inputCls}
                    placeholder={mode === "file" ? "缺省取文件名" : "缺省从域名推导"}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className="flex items-center gap-4">
                  <span className="w-16 text-tx3">category:</span>
                  <select
                    className="flex-1 border-b border-line bg-transparent py-1 pl-2 text-tx outline-none focus:border-acc"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                    <option value="__custom">自定义…</option>
                  </select>
                </label>
                {category === "__custom" && (
                  <label className="flex items-center gap-4">
                    <span className="w-16 text-tx3">自定义:</span>
                    <input
                      className={inputCls}
                      placeholder="自定义分类，如 kb / tool / git"
                      value={customCategory}
                      onChange={(e) => setCustomCategory(e.target.value)}
                    />
                  </label>
                )}
                <label className="flex items-center gap-4">
                  <span className="w-16 text-tx3">desc:</span>
                  <input
                    className={inputCls}
                    placeholder="一句话简介（可选）"
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                  />
                </label>
                {mode === "link" ? (
                  <label className="flex items-center gap-4">
                    <span className="w-16 text-tx3">url:</span>
                    <input
                      className={inputCls}
                      placeholder="https://cursor.sh"
                      value={url}
                      onChange={(e) => {
                        setUrl(e.target.value);
                        setFormError(null);
                      }}
                    />
                  </label>
                ) : (
                  <div className="col-span-2">
                    <div
                      className={`flex cursor-pointer items-center gap-3 rounded border border-dashed px-3 py-2 text-[11px] transition-colors ${
                        dragOver ? "border-acc text-acc" : "border-line text-tx3 hover:border-acc"
                      }`}
                      onClick={() => fileRef.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOver(false);
                        pickFile(e.dataTransfer.files[0] ?? null);
                      }}
                    >
                      <span className="text-acc">▤</span>
                      <span className="truncate">
                        {file ? file.name : "拖入文件，或点击选择"}
                      </span>
                      <span className="ml-auto flex-none">
                        {file ? formatBytes(file.size) : `≤ ${MAX_FILE_MB}MB`}
                      </span>
                      {file && (
                        <button
                          className="flex-none rounded border border-line px-1 text-[10px] text-tx3 hover:border-err hover:text-err"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            pickFile(null);
                          }}
                        >
                          ✗
                        </button>
                      )}
                    </div>
                    <input
                      ref={fileRef}
                      className="hidden"
                      type="file"
                      onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                )}
              </div>

              <div className="mt-2 flex items-center gap-2">
                <button
                  className="rounded border border-line px-2.5 py-1 text-[10px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
                  type="submit"
                  disabled={saving || (mode === "link" ? !url.trim() : !file)}
                >
                  {saving ? "⠋ 添加中" : "⏎ 添加"}
                </button>
                <span className="text-[10px] text-tx3">
                  // 文件落盘 data/toolbox · 卡片点击即打开 / 下载
                </span>
              </div>
              {formError && <div className="mt-1 text-[11px] text-err">✗ {formError}</div>}
            </form>
          ) : (
            <form className="px-3 py-2" onSubmit={addViaCommand}>
              <div className="flex items-center gap-2 text-[12px]">
                <span className="text-acc">▸</span>
                <input
                  className="min-w-0 flex-1 bg-transparent text-tx outline-none placeholder:text-tx3"
                  placeholder="alias.new https://cursor.sh #dev AI 代码编辑器"
                  value={cmd}
                  onChange={(e) => {
                    setCmd(e.target.value);
                    setAddError(null);
                  }}
                />
                <button
                  className="rounded border border-line px-2 py-0.5 text-[10px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
                  type="submit"
                  disabled={adding || !cmd.trim()}
                >
                  {adding ? "⠋ 添加中" : "⏎ 添加"}
                </button>
              </div>
              <div className="mt-1 text-[10px] text-tx3">
                // 命令模式仅支持链接 · 支持 --name 自定义别名 · 分类缺省 misc
              </div>
              {addError && <div className="mt-1 text-[11px] text-err">✗ {addError}</div>}
            </form>
            )}
          </div>
        </div>
      )}

      {notice && <div className="mb-3 text-[11px] text-acc">{notice}</div>}
      {error && (
        <div className="mb-3 rounded border border-err/50 bg-bg1 px-3 py-2 text-[12px] text-err">
          ✗ {error}
        </div>
      )}

      <ToolboxWall
        items={items}
        canWrite={canWrite}
        onOpen={open}
        onDelete={(item) => void remove(item)}
        emptyText={
          canWrite
            ? "// 百宝箱为空 —— 点击右上角「+ 添加工具」添加链接或上传文件"
            : "// 当前百宝箱没有工具"
        }
      />
    </div>
  );
}
