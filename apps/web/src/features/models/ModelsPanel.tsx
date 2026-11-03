import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModelDto, ModelKind, ModelTestResult } from "@aiwb/shared";
import { api } from "../../lib/api";
import { useAuthStore } from "../../stores/auth";
import { KIND_LABEL, PROVIDERS } from "./providers";

const STATUS_COLOR: Record<ModelDto["status"], string> = {
  ok: "text-acc",
  error: "text-err",
  untested: "text-tx3",
};
const STATUS_LABEL: Record<ModelDto["status"], string> = {
  ok: "可用",
  error: "异常",
  untested: "未测",
};

interface ModelForm {
  kind: ModelKind;
  provider: string;
  modelName: string;
  baseURL: string;
  apiKey: string;
  /** 留空 = 由厂商默认值决定 */
  temperature: string;
  topK: string;
}

const emptyForm = (): ModelForm => ({
  kind: "chat",
  provider: PROVIDERS[0].value,
  modelName: "",
  baseURL: PROVIDERS[0].baseURL,
  apiKey: "",
  temperature: "",
  topK: "",
});

/** 可选数值项：空串 = 不设置，非法数字返回 undefined */
function optionalNumber(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export default function ModelsPanel() {
  const role = useAuthStore((s) => s.user?.role);
  const canWrite = role === "owner";
  const [models, setModels] = useState<ModelDto[]>([]);
  const [testing, setTesting] = useState<Record<string, string | null>>({});
  const [showAdd, setShowAdd] = useState(false);
  /** 编辑目标：非 null 时表单处于编辑模式（点击卡片触发） */
  const [editing, setEditing] = useState<ModelDto | null>(null);
  const [form, setForm] = useState<ModelForm>(emptyForm);
  const [filter, setFilter] = useState<"all" | ModelKind>("all");

  const reload = useCallback(async () => {
    setModels(await api<ModelDto[]>("/models"));
  }, []);

  useEffect(() => {
    void reload().catch(() => setModels([]));
  }, [reload]);

  const preset = useMemo(
    () => PROVIDERS.find((p) => p.value === form.provider),
    [form.provider],
  );
  const suggestions = preset?.models[form.kind] ?? [];
  const shown = models.filter((m) => filter === "all" || m.kind === filter);

  const test = async (m: ModelDto) => {
    setTesting((t) => ({ ...t, [m.id]: null }));
    const r = await api<ModelTestResult>(`/models/${m.id}/test`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    setTesting((t) => ({ ...t, [m.id]: r.ok ? `✓ ${r.latencyMs}ms · ${r.reply?.slice(0, 60)}` : `✗ ${r.error?.slice(0, 80)}` }));
    await reload();
  };

  const add = async () => {
    await api("/models", {
      method: "POST",
      body: JSON.stringify({
        provider: form.provider,
        modelName: form.modelName.trim(),
        endpoint: form.baseURL.trim(),
        kind: form.kind,
        apiKey: form.apiKey.trim(),
        temperature: optionalNumber(form.temperature),
        topK: optionalNumber(form.topK),
      }),
    });
    setShowAdd(false);
    setForm(emptyForm());
    await reload();
  };

  /** 进入编辑：表单回填，apiKey 留空表示保持不变 */
  const startEdit = (m: ModelDto) => {
    if (!canWrite) return;
    setShowAdd(false);
    setEditing(m);
    setForm({
      kind: m.kind,
      provider: m.provider,
      modelName: m.modelName,
      baseURL: m.endpoint,
      apiKey: "",
      temperature: m.meta?.temperature != null ? String(m.meta.temperature) : "",
      topK: m.meta?.topK != null ? String(m.meta.topK) : "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEdit = () => {
    setEditing(null);
    setForm(emptyForm());
  };

  const saveEdit = async () => {
    if (!editing) return;
    const key = form.apiKey.trim();
    await api(`/models/${editing.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        provider: form.provider,
        modelName: form.modelName.trim(),
        endpoint: form.baseURL.trim(),
        kind: form.kind,
        // 留空 = 保持原 key；服务端仅在 truthy 时更新
        ...(key ? { apiKey: key } : {}),
        // 留空 = 清除覆盖回到厂商默认（服务端 null 语义）
        temperature: form.temperature.trim() === "" ? null : optionalNumber(form.temperature),
        topK: form.topK.trim() === "" ? null : optionalNumber(form.topK),
      }),
    });
    cancelEdit();
    await reload();
  };

  const closeForm = () => {
    if (editing) cancelEdit();
    else setShowAdd(false);
  };

  const remove = async (m: ModelDto) => {
    await api(`/models/${m.id}`, { method: "DELETE" });
    await reload();
  };

  const setProvider = (value: string) => {
    const p = PROVIDERS.find((x) => x.value === value);
    setForm((f) => ({ ...f, provider: value, baseURL: p?.baseURL ?? "", modelName: "" }));
  };

  const setKind = (kind: ModelKind) => {
    setForm((f) => ({ ...f, kind, modelName: "" }));
  };

  return (
    <div className="mx-auto w-[min(860px,94%)] py-8 font-mono">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-xs text-tx3">~/models · 模型管理</div>
        {canWrite && (
          <button
            className="rounded border border-line px-2.5 py-1 text-[11px] text-tx2 hover:border-acc hover:text-acc"
            onClick={() => {
              if (editing) cancelEdit();
              else {
                setForm(emptyForm());
                setShowAdd((v) => !v);
              }
            }}
          >
            {showAdd || editing ? "× 收起" : "+ 接入模型"}
          </button>
        )}
      </div>

      {(showAdd || editing) && (
        <div className="mb-4 rounded-lg border border-line bg-bg1 p-4 text-[12px]">
          {editing && (
            <div className="mb-3 flex items-center justify-between text-[11px]">
              <span className="text-acc">✎ 编辑模型 · {editing.provider}/{editing.modelName}</span>
              <button className="text-tx3 hover:text-tx2" onClick={closeForm}>
                × 取消
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2">
              <span className="w-20 text-tx3">type:</span>
              <select
                className="flex-1 border-b border-line bg-transparent py-1 text-tx outline-none focus:border-acc"
                value={form.kind}
                onChange={(e) => setKind(e.target.value as ModelKind)}
              >
                <option value="chat">对话 · chat</option>
                <option value="embedding">向量 · embedding</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-20 text-tx3">provider:</span>
              <select
                className="flex-1 border-b border-line bg-transparent py-1 text-tx outline-none focus:border-acc"
                value={form.provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
                {/* 兼容不在预设里的 provider（如内置 mock） */}
                {!PROVIDERS.some((p) => p.value === form.provider) && (
                  <option value={form.provider}>{form.provider}</option>
                )}
              </select>
            </label>
            <label className="col-span-2 flex items-center gap-2">
              <span className="w-20 text-tx3">model:</span>
              <input
                list="model-name-suggestions"
                placeholder={suggestions.length ? "从下拉选择，或直接输入模型名" : "输入厂商模型名"}
                className="flex-1 border-b border-line bg-transparent py-1 text-tx outline-none placeholder:text-tx3 focus:border-acc"
                value={form.modelName}
                onChange={(e) => setForm((f) => ({ ...f, modelName: e.target.value }))}
              />
              <datalist id="model-name-suggestions">
                {suggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
            <label className="col-span-2 flex items-center gap-2">
              <span className="w-20 text-tx3">baseURL:</span>
              <input
                className="flex-1 border-b border-line bg-transparent py-1 text-tx outline-none placeholder:text-tx3 focus:border-acc"
                placeholder="https://api.openai.com/v1"
                value={form.baseURL}
                onChange={(e) => setForm((f) => ({ ...f, baseURL: e.target.value }))}
              />
            </label>
            <label className="col-span-2 flex items-center gap-2">
              <span className="w-20 text-tx3">apiKey:</span>
              <input
                className="flex-1 border-b border-line bg-transparent py-1 text-tx outline-none placeholder:text-tx3 focus:border-acc"
                placeholder={editing ? "留空 = 保持原 key 不变" : "sk-..."}
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="w-20 text-tx3">temperature:</span>
              <input
                className="flex-1 border-b border-line bg-transparent py-1 text-tx outline-none placeholder:text-tx3 focus:border-acc"
                placeholder="可选，如 0.7"
                type="number"
                step="0.1"
                min={0}
                max={2}
                value={form.temperature}
                onChange={(e) => setForm((f) => ({ ...f, temperature: e.target.value }))}
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="w-20 text-tx3">topK:</span>
              <input
                className="flex-1 border-b border-line bg-transparent py-1 text-tx outline-none placeholder:text-tx3 focus:border-acc"
                placeholder="可选，如 40"
                type="number"
                min={0}
                value={form.topK}
                onChange={(e) => setForm((f) => ({ ...f, topK: e.target.value }))}
              />
            </label>
          </div>
          <div className="mt-2 text-[10px] text-tx3">
            // 对话模型走 /chat/completions，向量模型走 /embeddings；temperature / topK 留空即用厂商默认
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              className="rounded border border-line px-3 py-1 text-[11px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
              disabled={!form.provider || !form.modelName.trim() || !form.baseURL.trim()}
              onClick={editing ? saveEdit : add}
            >
              {editing ? "⏎ 保存修改" : "⏎ 保存"}
            </button>
            {editing && (
              <button className="text-[11px] text-tx3 hover:text-tx2" onClick={cancelEdit}>
                取消
              </button>
            )}
          </div>
        </div>
      )}

      <div className="mb-3 flex items-center gap-1.5 text-[10px]">
        {(["all", "chat", "embedding"] as const).map((k) => (
          <button
            key={k}
            className={`rounded border px-2 py-0.5 ${
              filter === k ? "border-acc text-acc" : "border-line text-tx3 hover:text-tx2"
            }`}
            onClick={() => setFilter(k)}
          >
            {k === "all" ? `全部 ${models.length}` : `${KIND_LABEL[k]} ${models.filter((m) => m.kind === k).length}`}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        {shown.map((m) => (
          <div
            key={m.id}
            className={`rounded-lg border bg-bg1 transition-colors hover:border-acc/40 ${
              editing?.id === m.id ? "border-acc" : "border-line"
            }`}
          >
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-[11px] text-tx3">
                {m.provider} · {KIND_LABEL[m.kind]}
              </span>
              <span className={`text-[11px] ${STATUS_COLOR[m.status]}`}>
                ● {STATUS_LABEL[m.status]}
              </span>
            </div>
            <div
              className={`px-3 py-3 ${canWrite ? "cursor-pointer" : ""}`}
              title={canWrite ? "点击编辑该模型" : undefined}
              onClick={() => startEdit(m)}
            >
              <div className="text-[14px] font-bold text-tx">{m.modelName}</div>
              <div className="mt-1 truncate text-[11px] text-tx3">{m.endpoint}</div>
              <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-tx2">
                <span>
                  key:{" "}
                  <span className={`mr-1.5 ${m.hasKey ? "text-acc" : "text-tx3"}`}>
                    {m.hasKey ? "▣" : "□"}
                  </span>
                  {m.hasKey ? "已配置" : "未配置"}
                </span>
                {m.meta?.latencyMs != null && <span>⏱ {m.meta.latencyMs}ms</span>}
                {m.meta?.temperature != null && <span>temp {m.meta.temperature}</span>}
                {m.meta?.topK != null && <span>topK {m.meta.topK}</span>}
                {(m.priceIn > 0 || m.priceOut > 0) && (
                  <span className="text-warn">
                    ¥{(m.priceIn / 100).toFixed(4)}/¥{(m.priceOut / 100).toFixed(4)} per 1k in/out
                  </span>
                )}
                {m.meta?.priceNote && <span>{m.meta.priceNote}</span>}
              </div>
              {testing[m.id] !== undefined && testing[m.id] !== null && (
                <div className={`mt-2 text-[11px] ${testing[m.id]?.startsWith("✓") ? "text-acc" : "text-err"}`}>
                  {testing[m.id]}
                </div>
              )}
            </div>
            <div className="flex gap-2 border-t border-line px-3 py-2">
              <button
                className="text-[11px] text-tx2 hover:text-acc"
                onClick={() => test(m)}
                disabled={testing[m.id] === null}
              >
                {testing[m.id] === null
                  ? "⠋ 测试中"
                  : m.kind === "embedding"
                    ? "▸ 向量测试"
                    : "▸ 对话测试"}
              </button>
              {canWrite && (
                <button className="ml-auto text-[11px] text-tx3 hover:text-err" onClick={() => remove(m)}>
                  ✗ 删除
                </button>
              )}
            </div>
          </div>
        ))}
        {shown.length === 0 && (
          <div className="col-span-2 rounded-lg border border-dashed border-line py-12 text-center text-xs text-tx3">
            {models.length === 0
              ? `尚未接入任何模型 —— ${canWrite ? "点击右上角 + 接入模型" : "等待 owner 配置"}`
              : `// 当前筛选下没有模型`}
          </div>
        )}
      </div>
    </div>
  );
}
