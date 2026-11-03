import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  TOOL_KINDS,
  type CustomToolDto,
  type ToolKind,
  type ToolSchemaDto,
  type UpsertCustomToolInput,
} from "@aiwb/shared";
import { api } from "../../lib/api";
import { useAuthStore } from "../../stores/auth";

type Filter = "all" | ToolKind;

/** 类型徽章样式：终端配色 token，预留类型用低饱和色 */
const KIND_META: Record<ToolKind, { label: string; cls: string }> = {
  function: { label: "function", cls: "text-tx2" },
  http: { label: "http", cls: "text-acc" },
  shell: { label: "shell", cls: "text-warn" },
  database: { label: "database", cls: "text-tx" },
  mcp: { label: "mcp", cls: "text-tx3" },
};

interface Row {
  key: string;
  name: string;
  description: string;
  permission: string;
  kind: ToolKind;
  custom: boolean;
  enabled: boolean;
  createdBy?: "ai" | "user";
  argsSchema?: Record<string, unknown> | null;
  dto?: CustomToolDto;
}

const inputCls =
  "w-full border-b border-line bg-transparent py-1 pl-2 text-tx outline-none placeholder:text-tx3 focus:border-acc";

/** 工具管理：内置工具只读清单 + 自定义工具（AI 自写 / 手工）启停与维护 */
export default function ToolsManagerPanel() {
  const role = useAuthStore((s) => s.user?.role ?? "guest");
  const canWrite = role !== "guest";

  const [schemas, setSchemas] = useState<ToolSchemaDto[]>([]);
  const [customs, setCustoms] = useState<CustomToolDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([
        api<ToolSchemaDto[]>("/tools"),
        api<CustomToolDto[]>("/tools/custom"),
      ]);
      setSchemas(s);
      setCustoms(c);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo<Row[]>(() => {
    const byName = new Map(customs.map((c) => [c.name, c]));
    const list: Row[] = [];
    for (const s of schemas) {
      if (s.custom) {
        const dto = byName.get(s.name);
        list.push({
          key: dto?.id ?? s.name,
          name: s.name,
          description: s.description,
          permission: s.permission,
          kind: dto?.kind ?? s.kind ?? "http",
          custom: true,
          enabled: true,
          createdBy: dto?.createdBy,
          argsSchema: s.argsSchema,
          dto,
        });
        if (dto) byName.delete(s.name);
      } else {
        list.push({
          key: s.name,
          name: s.name,
          description: s.description,
          permission: s.permission,
          kind: s.kind ?? "function",
          custom: false,
          enabled: true,
          argsSchema: s.argsSchema,
        });
      }
    }
    // 停用的自定义工具不在 registry 里，从 custom 表补进来
    for (const dto of byName.values()) {
      list.push({
        key: dto.id,
        name: dto.name,
        description: dto.description,
        permission: "tools:custom",
        kind: dto.kind,
        custom: true,
        enabled: false,
        createdBy: dto.createdBy,
        argsSchema: dto.argsSchema,
        dto,
      });
    }
    return list.sort((a, b) => Number(a.custom) - Number(b.custom) || a.name.localeCompare(b.name));
  }, [schemas, customs]);

  const kindCounts = useMemo(() => {
    const m = new Map<ToolKind, number>();
    for (const r of rows) m.set(r.kind, (m.get(r.kind) ?? 0) + 1);
    return m;
  }, [rows]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.kind !== filter) return false;
      if (!kw) return true;
      return r.name.includes(kw) || r.description.toLowerCase().includes(kw);
    });
  }, [rows, q, filter]);

  const stats = useMemo(() => {
    const customCount = customs.length;
    const enabledCount = customs.filter((c) => c.enabled).length;
    return { total: rows.length, custom: customCount, enabled: enabledCount };
  }, [rows, customs]);

  const toggle = async (dto: CustomToolDto) => {
    try {
      await api(`/tools/custom/${dto.id}/toggle`, { method: "POST" });
      setNotice(dto.enabled ? `已停用 ${dto.name}` : `已启用 ${dto.name}，Agent 现在可以调用它`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (dto: CustomToolDto) => {
    try {
      await api(`/tools/custom/${dto.id}`, { method: "DELETE" });
      setConfirmDel(null);
      setNotice(`已删除 ${dto.name}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mx-auto max-w-[860px] px-4 py-4 font-mono text-[12px] text-tx2">
      {/* 头部统计 + 操作 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-tx3">
          共 <span className="text-tx">{stats.total}</span> 个 · 自定义{" "}
          <span className="text-acc">{stats.custom}</span> · 已启用{" "}
          <span className="text-acc">{stats.enabled}</span>
        </div>
        {canWrite && (
          <button
            className="border border-line px-2 py-1 text-[11px] text-tx3 hover:border-acc hover:text-acc"
            onClick={() => setShowCreate((v) => !v)}
          >
            {showCreate ? "− 收起" : "+ 手动创建"}
          </button>
        )}
      </div>

      {/* 手动创建表单 */}
      {showCreate && canWrite && (
        <CreateForm
          onDone={async (msg) => {
            setShowCreate(false);
            setNotice(msg);
            await load();
          }}
          onError={setError}
        />
      )}

      {/* 类型筛选 + 搜索（扁平列表，预留类型展示为 0 计数） */}
      <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-line pb-2">
        <div className="flex flex-wrap gap-1">
          <button
            className={`px-2 py-0.5 text-[11px] ${
              filter === "all" ? "bg-bg2 text-acc" : "text-tx3 hover:text-tx2"
            }`}
            onClick={() => setFilter("all")}
          >
            全部 {rows.length}
          </button>
          {TOOL_KINDS.map((k) => (
            <button
              key={k}
              className={`px-2 py-0.5 text-[11px] ${
                filter === k ? "bg-bg2 text-acc" : "text-tx3 hover:text-tx2"
              }`}
              onClick={() => setFilter(k)}
            >
              {KIND_META[k].label} {kindCounts.get(k) ?? 0}
            </button>
          ))}
        </div>
        <input
          className={`${inputCls} max-w-[240px]`}
          placeholder="搜索名称 / 描述…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {notice && <div className="mb-2 text-[11px] text-acc">▸ {notice}</div>}
      {error && <div className="mb-2 text-[11px] text-err">▸ {error}</div>}
      {loading && <div className="py-8 text-center text-tx3">loading…</div>}

      {!loading && filtered.length === 0 && (
        <div className="border border-dashed border-line py-10 text-center text-tx3">
          {filter === "shell" || filter === "database" || filter === "mcp" ? (
            <>
              <div>{KIND_META[filter].label} 类型为预留类型</div>
              <div className="mt-2 text-[11px]">数据模型与面板已就位，执行器将在后续版本支持</div>
            </>
          ) : (
            <>
              <div>没有匹配的工具</div>
              <div className="mt-2 text-[11px]">
                也可以在聊天里直接让 AI 帮你写一个工具，例如：「帮我写一个查询天气的工具」
              </div>
            </>
          )}
        </div>
      )}

      {/* 工具清单 */}
      <div className="space-y-px">
        {filtered.map((r) => (
          <div key={r.key} className="border border-line bg-bg1">
            <div
              className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-bg2"
              onClick={() => setExpanded(expanded === r.key ? null : r.key)}
            >
              <span className="text-tx3">{expanded === r.key ? "▾" : "▸"}</span>
              <span className={`shrink-0 ${r.custom ? "text-acc" : "text-tx"}`}>{r.name}</span>
              <span className="min-w-0 flex-1 truncate text-tx3">{r.description}</span>
              {r.custom && r.createdBy === "ai" && (
                <span className="shrink-0 border border-line px-1 text-[10px] text-warn">AI 写</span>
              )}
              <span className={`shrink-0 border border-line px-1 text-[10px] ${KIND_META[r.kind].cls}`}>
                {KIND_META[r.kind].label}
              </span>
              <span className="shrink-0 border border-line px-1 text-[10px] text-tx3">
                {r.permission}
              </span>
              {r.custom && r.dto && canWrite ? (
                <button
                  className={`shrink-0 border px-2 py-0.5 text-[10px] ${
                    r.enabled
                      ? "border-acc text-acc hover:border-err hover:text-err"
                      : "border-line text-tx3 hover:border-acc hover:text-acc"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggle(r.dto!);
                  }}
                >
                  {r.enabled ? "● 已启用" : "○ 已停用"}
                </button>
              ) : (
                !r.custom && <span className="shrink-0 text-[10px] text-tx3">内置</span>
              )}
            </div>

            {expanded === r.key && (
              <div className="border-t border-line px-3 py-2 text-[11px]">
                {r.argsSchema && (
                  <div className="mb-2">
                    <div className="mb-1 text-tx3">argsSchema</div>
                    <pre className="overflow-x-auto bg-bg p-2 text-tx2">
                      {JSON.stringify(r.argsSchema, null, 2)}
                    </pre>
                  </div>
                )}
                {r.dto && (
                  <>
                    <div className="mb-1 text-tx3">HTTP 声明</div>
                    <pre className="overflow-x-auto bg-bg p-2 text-tx2">
{`${r.dto.spec.method} ${r.dto.spec.url}${r.dto.spec.headers ? `\nheaders: ${JSON.stringify(r.dto.spec.headers)}` : ""}${r.dto.spec.bodyTemplate ? `\nbody: ${r.dto.spec.bodyTemplate}` : ""}`}
                    </pre>
                    <div className="mt-1 text-tx3">
                      创建于 {new Date(r.dto.createdAt).toLocaleString()} · 来源{" "}
                      {r.dto.createdBy === "ai" ? "AI 聊天创建" : "手动创建"}
                    </div>
                    {canWrite && (
                      <div className="mt-2 flex justify-end">
                        {confirmDel === r.dto.id ? (
                          <span className="flex items-center gap-2">
                            <span className="text-err">确认删除？注册表将同步移除</span>
                            <button
                              className="border border-err px-2 py-0.5 text-err"
                              onClick={() => void remove(r.dto!)}
                            >
                              删除
                            </button>
                            <button
                              className="border border-line px-2 py-0.5 text-tx3"
                              onClick={() => setConfirmDel(null)}
                            >
                              取消
                            </button>
                          </span>
                        ) : (
                          <button
                            className="border border-line px-2 py-0.5 text-tx3 hover:border-err hover:text-err"
                            onClick={() => setConfirmDel(r.dto!.id)}
                          >
                            × 删除工具
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-line pt-2 text-[11px] leading-5 text-tx3">
        <div>· AI 在聊天里通过 tools.create 写的工具默认停用，启用后才会注册给 Agent 使用</div>
        <div>· 自定义工具统一使用 custom.* 命名空间，执行需 tools:custom 权限</div>
        <div>· 类型体系：function=内置函数 · http=声明式 HTTP（已支持创建）· shell / database / mcp 为预留类型</div>
      </div>
    </div>
  );
}

/** 手动创建表单：声明式 HTTP 工具 */
function CreateForm({
  onDone,
  onError,
}: {
  onDone: (msg: string) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [argsSchema, setArgsSchema] = useState(
    '{\n  "type": "object",\n  "properties": {},\n  "required": []\n}',
  );
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let parsedHeaders: Record<string, string> | undefined;
    let parsedSchema: Record<string, unknown> | undefined;
    try {
      if (headers.trim()) parsedHeaders = JSON.parse(headers);
      if (argsSchema.trim()) parsedSchema = JSON.parse(argsSchema);
    } catch {
      onError("headers / argsSchema 需要是合法 JSON");
      return;
    }
    const input: UpsertCustomToolInput = {
      name,
      description,
      method: method as UpsertCustomToolInput["method"],
      url,
      headers: parsedHeaders,
      bodyTemplate: bodyTemplate || undefined,
      argsSchema: parsedSchema,
    };
    setSaving(true);
    try {
      const dto = await api<CustomToolDto>("/tools/custom", {
        method: "POST",
        body: JSON.stringify(input),
      });
      await onDone(`已创建并启用 ${dto.name}`);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="mb-3 border border-line bg-bg1 p-3" onSubmit={submit}>
      <div className="mb-2 text-[11px] text-tx3">
        手动创建即启用；模板用 {"{{参数名}}"} 占位，url 中会自动 URL 编码
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <input className={inputCls} placeholder="名称，如 weather（自动加 custom. 前缀）" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className={inputCls} placeholder="一句话描述" value={description} onChange={(e) => setDescription(e.target.value)} required />
      </div>
      <div className="mb-2 flex gap-2">
        <select
          className="border border-line bg-bg px-2 py-1 text-tx2 outline-none focus:border-acc"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        >
          {["GET", "POST", "PUT", "DELETE"].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <input className={inputCls} placeholder="https://api.example.com/xxx?q={{q}}" value={url} onChange={(e) => setUrl(e.target.value)} required />
      </div>
      <textarea className={`${inputCls} mb-2 h-14 resize-y border`} placeholder='headers JSON（可选），如 {"Authorization":"Bearer {{token}}"}' value={headers} onChange={(e) => setHeaders(e.target.value)} />
      {(method === "POST" || method === "PUT") && (
        <textarea className={`${inputCls} mb-2 h-14 resize-y border`} placeholder='body 模板（可选），如 {"q":"{{q}}"}' value={bodyTemplate} onChange={(e) => setBodyTemplate(e.target.value)} />
      )}
      <textarea className={`${inputCls} mb-2 h-20 resize-y border`} placeholder="argsSchema JSON" value={argsSchema} onChange={(e) => setArgsSchema(e.target.value)} />
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="border border-acc px-3 py-1 text-acc hover:bg-acc hover:text-bg disabled:opacity-50"
        >
          {saving ? "创建中…" : "创建"}
        </button>
      </div>
    </form>
  );
}
