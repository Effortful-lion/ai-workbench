import { useEffect, useMemo, useState } from "react";
import { DEFAULT_AGENT_BUDGET, type AgentBudget, type AgentDto, type AgentPhase, type ModelDto } from "@aiwb/shared";
import type { ToolSchemaDto } from "@aiwb/shared";
import { api } from "../../lib/api";
import { useAgentsStore } from "../../stores/agents";
import { useChatStore } from "../../stores/chat";
import { usePanelStore } from "../../stores/panel";

interface FormState {
  id: string | null;
  name: string;
  personaPrompt: string;
  tools: Set<string>;
  phases: AgentPhase[];
  /** null = 不启用自定义预算（用服务端默认） */
  budget: AgentBudget | null;
}

const EMPTY: FormState = {
  id: null,
  name: "",
  personaPrompt: "",
  tools: new Set(),
  phases: [],
  budget: null,
};

const PHASE_EMPTY: AgentPhase = { name: "", goal: "", tools: null, requireConfirm: false };
const DRAFT_KEY = "aiwb-agent-draft";

/** 按 tool.name 的模块前缀分组（models.xxx → "models"） */
function groupTools(tools: ToolSchemaDto[]) {
  const groups: Record<string, ToolSchemaDto[]> = {};
  for (const t of tools) {
    const mod = t.name.split(".")[0] ?? "other";
    (groups[mod] ??= []).push(t);
  }
  return groups;
}

/** AI 助手面板：Agent 卡片阵列 + 创建/编辑（人设 + 工具+分组折叠 + 预算 + 阶段流程+顺序调整）+ draft 自动保存 */
export default function AgentsPanel() {
  const { agents, toolSchemas, load, create, update, remove } = useAgentsStore();
  const startAgentChat = useChatStore((s) => s.startAgentChat);
  const closeAll = usePanelStore((s) => s.closeAll);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelDto[]>([]);
  const [collapsedMods, setCollapsedMods] = useState<Set<string>>(new Set());

  // tools 按模块分组（useMemo 避免每次 render 重建）
  const toolGroups = useMemo(() => groupTools(toolSchemas), [toolSchemas]);

  // 打开编辑器时，恢复 draft（如果有）
  useEffect(() => {
    if (!form) {
      // 关闭编辑器时不自动恢复，等用户点 + 新建再检查
    }
  }, [form]);

  useEffect(() => {
    void load();
    api<ModelDto[]>("/models").then(setModels).catch(() => {});
  }, [load]);

  /** 用户点 + 新建：如果有 draft，提示恢复 */
  const openNew = () => {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      try {
        const draft = JSON.parse(raw);
        // draft 是新建态才恢复（id=null）
        if (draft.id === null && confirm("检测到未保存的 Agent 草稿，恢复？取消则丢弃草稿。")) {
          setForm({ ...draft, tools: new Set(draft.tools ?? []) });
          localStorage.removeItem(DRAFT_KEY);
          return;
        }
      } catch { /* ignore */ }
    }
    setForm({ ...EMPTY, tools: new Set() });
  };

  // form 变化 → 自动存 draft（节流 300ms）
  useEffect(() => {
    if (!form) return;
    const t = setTimeout(() => {
      try {
        const toSave = { ...form, tools: [...form.tools] };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(toSave));
      } catch { /* ignore quota */ }
    }, 300);
    return () => clearTimeout(t);
  }, [form]);

  const save = async () => {
    if (!form) return;
    setError(null);
    try {
      const input = {
        name: form.name,
        personaPrompt: form.personaPrompt,
        tools: [...form.tools],
        phases: form.phases.length ? form.phases : null,
        budget: form.budget,
      };
      if (form.id) await update(form.id, input);
      else await create(input);
      localStorage.removeItem(DRAFT_KEY);
      setForm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const chatWith = (a: AgentDto) => {
    startAgentChat(a.id);
    closeAll();
  };

  const edit = (a: AgentDto) => {
    // 编辑已有 agent，先清掉 draft（draft 只用于新建态）
    localStorage.removeItem(DRAFT_KEY);
    setForm({
      id: a.id,
      name: a.name,
      personaPrompt: a.personaPrompt,
      tools: new Set(a.tools),
      phases: a.phases ?? [],
      budget: a.budget ? { ...a.budget } : null,
    });
  };

  const toggleBudget = () => {
    setForm((f) => (f ? { ...f, budget: f.budget ? null : { ...DEFAULT_AGENT_BUDGET } } : f));
  };

  const setBudgetField = (k: keyof AgentBudget, v: number) => {
    setForm((f) => (f && f.budget ? { ...f, budget: { ...f.budget, [k]: v } } : f));
  };

  const addPhase = () => {
    setForm((f) => (f ? { ...f, phases: [...f.phases, { ...PHASE_EMPTY }] } : f));
  };

  const updatePhase = (idx: number, patch: Partial<AgentPhase>) => {
    setForm((f) => {
      if (!f) return f;
      const phases = [...f.phases];
      phases[idx] = { ...phases[idx], ...patch };
      return { ...f, phases };
    });
  };

  const removePhase = (idx: number) => {
    setForm((f) => (f ? { ...f, phases: f.phases.filter((_, i) => i !== idx) } : f));
  };

  const movePhase = (idx: number, dir: -1 | 1) => {
    setForm((f) => {
      if (!f) return f;
      const target = idx + dir;
      if (target < 0 || target >= f.phases.length) return f;
      const phases = [...f.phases];
      [phases[idx], phases[target]] = [phases[target], phases[idx]];
      return { ...f, phases };
    });
  };

  const toggleMod = (mod: string) => {
    setCollapsedMods((s) => {
      const n = new Set(s);
      if (n.has(mod)) n.delete(mod);
      else n.add(mod);
      return n;
    });
  };

  // 默认展开前 2 个模块
  useEffect(() => {
    const keys = Object.keys(toolGroups);
    const toCollapse = keys.slice(2);
    setCollapsedMods(new Set(toCollapse));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolSchemas.length]);

  return (
    <div className="mx-auto w-[min(860px,94%)] py-8 font-mono">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-xs text-tx3">~/agents · AI 助手</div>
        <button
          className="rounded border border-line px-2.5 py-1 text-[11px] text-tx2 hover:border-acc hover:text-acc"
          onClick={() => (form ? setForm(null) : openNew())}
        >
          {form ? "× 收起" : "+ 新建 Agent"}
        </button>
      </div>

      {form && (
        <div className="mb-4 rounded-lg border border-line bg-bg1 p-4 text-[12px]">
          <div className="mb-3 flex items-center gap-2 text-[11px] text-tx3">
            <span>{form.id ? "// 编辑 Agent" : "// Agent = 人设 + 工具 + 预算 + 阶段流程"}</span>
            {form.id === null && <span className="text-warn">· draft 自动保存中</span>}
          </div>

          {/* 基础字段 */}
          <label className="mb-3 flex items-center gap-2">
            <span className="w-20 flex-none text-tx3">name:</span>
            <input
              className="flex-1 border-b border-line bg-transparent py-1 text-tx outline-none focus:border-acc"
              value={form.name}
              placeholder="如：运维小助手"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="mb-3 flex items-start gap-2">
            <span className="w-20 flex-none pt-1 text-tx3">persona:</span>
            <textarea
              className="h-20 flex-1 resize-none border-b border-line bg-transparent py-1 text-tx outline-none focus:border-acc"
              value={form.personaPrompt}
              placeholder="你是…（语气、专长、回答风格的指令）"
              onChange={(e) => setForm({ ...form, personaPrompt: e.target.value })}
            />
          </label>

          {/* tools — 按模块分组折叠 */}
          <div className="mb-3 rounded border border-line p-3">
            <span className="mb-2 block text-[11px] text-tx3">// tools（按模块分组 · 点击折叠）</span>
            {toolSchemas.length === 0 && <div className="text-[11px] text-tx3">// 当前角色无可用工具</div>}
            <div className="flex flex-col gap-2">
              {Object.entries(toolGroups).map(([mod, tools]) => {
                const collapsed = collapsedMods.has(mod);
                const checkedCount = tools.filter((t) => form.tools.has(t.name)).length;
                return (
                  <div key={mod}>
                    <button
                      className="flex w-full items-center gap-1 text-[11px] text-tx2 hover:text-tx"
                      onClick={() => toggleMod(mod)}
                    >
                      <span className="text-tx3">{collapsed ? "▸" : "▾"}</span>
                      <span className="text-acc">{mod}</span>
                      <span className="text-tx3">
                        ({checkedCount}/{tools.length})
                      </span>
                    </button>
                    {!collapsed && (
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5 pl-4">
                        {tools.map((t) => (
                          <label
                            key={t.name}
                            className="flex cursor-pointer items-center gap-1.5 text-tx2 hover:text-tx"
                            title={`${t.description}（需 ${t.permission}）`}
                          >
                            <input
                              type="checkbox"
                              className="accent-[#00E59B]"
                              checked={form.tools.has(t.name)}
                              onChange={(e) => {
                                const next = new Set(form.tools);
                                if (e.target.checked) next.add(t.name);
                                else next.delete(t.name);
                                setForm({ ...form, tools: next });
                              }}
                            />
                            {t.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 预算编辑器 */}
          <div className="mb-3 rounded border border-line p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] text-tx3">// budget（运行安全带）</span>
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-tx2">
                <input
                  type="checkbox"
                  className="accent-[#00E59B]"
                  checked={!!form.budget}
                  onChange={toggleBudget}
                />
                启用
              </label>
            </div>
            {form.budget ? (
              <div className="grid grid-cols-5 gap-2 text-[11px]">
                <NumField label="concurrency" value={form.budget.maxConcurrency} min={1} max={16}
                  onChange={(v) => setBudgetField("maxConcurrency", v)} />
                <NumField label="depth" value={form.budget.maxDepth} min={0} max={8}
                  onChange={(v) => setBudgetField("maxDepth", v)} />
                <NumField label="tokens" value={form.budget.maxTotalTokens} min={1000} step={1000}
                  onChange={(v) => setBudgetField("maxTotalTokens", v)} />
                <NumField label="cost¥" value={form.budget.maxCostYuan} min={0} step={1}
                  onChange={(v) => setBudgetField("maxCostYuan", v)} />
                <NumField label="timeout(s)" value={form.budget.timeoutSec} min={5} max={7200} step={5}
                  onChange={(v) => setBudgetField("timeoutSec", v)} />
              </div>
            ) : (
              <div className="text-[11px] text-tx3">// 未启用 → 服务端默认：concurrency=4, depth=2, tokens=100k, cost¥5, timeout=300s</div>
            )}
          </div>

          {/* 阶段流程编辑器 — 含 ↑↓ 顺序调整 */}
          <div className="mb-3 rounded border border-line p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] text-tx3">// phases（阶段化流程 · 可选）</span>
              <button
                className="text-[11px] text-tx2 hover:text-acc"
                onClick={addPhase}
              >
                + 添加阶段
              </button>
            </div>
            {form.phases.length === 0 ? (
              <div className="text-[11px] text-tx3">// 单模型直跑（无阶段切换）</div>
            ) : (
              <div className="flex flex-col gap-2">
                {form.phases.map((p, i) => (
                  <div key={i} className="rounded border border-line bg-bg2 p-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-tx3">#{i + 1}</span>
                      <input
                        className="flex-1 border-b border-line bg-transparent py-0.5 text-tx outline-none focus:border-acc"
                        value={p.name}
                        placeholder="阶段名：如「调研」"
                        onChange={(e) => updatePhase(i, { name: e.target.value })}
                      />
                      {/* ↑↓ 顺序调整 */}
                      <div className="flex items-center gap-0.5">
                        <button
                          className="text-[10px] text-tx3 hover:text-acc disabled:opacity-20"
                          onClick={() => movePhase(i, -1)}
                          disabled={i === 0}
                          title="上移"
                        >
                          ↑
                        </button>
                        <button
                          className="text-[10px] text-tx3 hover:text-acc disabled:opacity-20"
                          onClick={() => movePhase(i, 1)}
                          disabled={i === form.phases.length - 1}
                          title="下移"
                        >
                          ↓
                        </button>
                      </div>
                      <label className="flex items-center gap-1 text-[10px] text-tx3">
                        <input
                          type="checkbox"
                          className="accent-[#00E59B]"
                          checked={!!p.requireConfirm}
                          onChange={(e) => updatePhase(i, { requireConfirm: e.target.checked })}
                        />
                        确认
                      </label>
                      <button
                        className="text-[10px] text-tx3 hover:text-err"
                        onClick={() => removePhase(i)}
                      >
                        ✗
                      </button>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[10px]">
                      <span className="text-tx3">model:</span>
                      <select
                        className="flex-1 cursor-pointer rounded border border-line bg-bg1 px-1 py-0.5 text-tx outline-none hover:border-acc focus:border-acc"
                        value={p.modelId ?? ""}
                        onChange={(e) => updatePhase(i, { modelId: e.target.value || null })}
                      >
                        <option value="">◐ 默认模型</option>
                        {models.map((m) => (
                          <option key={m.id} value={m.id}>
                            ◑ {m.provider}/{m.modelName}
                            {m.status === "ok" ? "" : m.status === "error" ? " ✗" : " ?"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <textarea
                      className="mt-1 h-12 w-full resize-none border-b border-line bg-transparent py-0.5 text-[11px] text-tx outline-none focus:border-acc"
                      value={p.goal}
                      placeholder="该阶段要达成的目标（注入 system prompt）"
                      onChange={(e) => updatePhase(i, { goal: e.target.value })}
                    />
                    <div className="mt-1 flex items-center gap-1 text-[10px]">
                      <span className="text-tx3">tools(逗号分隔,留空=跟Agent):</span>
                      <input
                        className="flex-1 border-b border-line bg-transparent py-0.5 text-tx outline-none focus:border-acc"
                        value={p.tools?.join(", ") ?? ""}
                        onChange={(e) => {
                          const v = e.target.value.trim();
                          updatePhase(i, { tools: v ? v.split(",").map((s) => s.trim()) : null });
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <div className="mb-2 text-[11px] text-err">✗ {error}</div>}
          <div className="flex items-center gap-2">
            <button
              className="rounded border border-line px-3 py-1 text-[11px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
              disabled={!form.name.trim()}
              onClick={save}
            >
              ⏎ 保存
            </button>
            {form.id === null && (
              <button
                className="text-[11px] text-tx3 hover:text-err"
                onClick={() => { localStorage.removeItem(DRAFT_KEY); setForm(null); }}
              >
                丢弃草稿
              </button>
            )}
          </div>
        </div>
      )}

      {/* Agent 卡片列表 */}
      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        {agents.map((a) => (
          <div key={a.id} className="rounded-lg border border-line bg-bg1 transition-colors hover:border-acc/40">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-[11px] text-tx3">agent</span>
              <span className="text-[11px] text-acc">
                ◐ {a.tools.length} tools
                {a.budget && <span className="ml-2 text-warn">·预算</span>}
                {a.phases?.length && <span className="ml-2 text-warn">·{a.phases.length}阶段</span>}
              </span>
            </div>
            <div className="px-3 py-3">
              <div className="text-[14px] font-bold text-tx">{a.name}</div>
              <div className="mt-1 line-clamp-2 min-h-[2em] text-[11px] leading-relaxed text-tx3">
                {a.personaPrompt || "// 无人设，通用助手"}
              </div>
              {a.tools.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {a.tools.map((t) => (
                    <span key={t} className="rounded border border-line px-1.5 py-0.5 text-[10px] text-tx2">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {/* 预算/阶段摘要 */}
              {(a.budget || a.phases?.length) && (
                <div className="mt-2 border-t border-line pt-2 text-[10px] text-tx3">
                  {a.budget && (
                    <div>
                      ⚡ tokens={a.budget.maxTotalTokens} cost¥{a.budget.maxCostYuan} timeout={a.budget.timeoutSec}s
                    </div>
                  )}
                  {a.phases?.length && (
                    <div>
                      phases: {a.phases.map((p) => p.name).join(" → ")}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-2 border-t border-line px-3 py-2">
              <button className="text-[11px] text-tx2 hover:text-acc" onClick={() => chatWith(a)}>
                ▸ 对话
              </button>
              <button className="text-[11px] text-tx3 hover:text-tx" onClick={() => edit(a)}>
                ✎ 编辑
              </button>
              <button className="ml-auto text-[11px] text-tx3 hover:text-err" onClick={() => void remove(a.id)}>
                ✗ 删除
              </button>
            </div>
          </div>
        ))}
        {agents.length === 0 && (
          <div className="col-span-2 rounded-lg border border-dashed border-line py-12 text-center text-xs text-tx3">
            还没有 Agent —— 点击右上角 + 新建，把工具能力装进一个人设里
          </div>
        )}
      </div>
    </div>
  );
}

/** 小数字输入框：label + input 紧凑排列 */
function NumField({
  label, value, onChange, min, max, step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] text-tx3">{label}</span>
      <input
        type="number"
        className="border-b border-line bg-transparent py-0.5 text-tx outline-none focus:border-acc"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
