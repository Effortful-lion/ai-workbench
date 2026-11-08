import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ModelDto,
  PipeDigestDto,
  PipeRunDto,
  PipeRunStatus,
  PipeSopDto,
  PipeSopStatus,
} from "@aiwb/shared";
import { api } from "../../lib/api";
import { MarkdownText } from "../../lib/markdown";
import { useAuthStore } from "../../stores/auth";

const pad = (n: number) => String(n).padStart(2, "0");

function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDay(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(ts);
  that.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m}m` : `${m}m${s}s`;
}

function oneLine(s: string, max = 96): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function sopBadge(s: PipeSopDto): { label: string; cls: string } {
  if (s.status === "running") return { label: "运行中", cls: "border-warn/50 text-warn" };
  if (s.status === "paused") return { label: "已暂停", cls: "border-line text-tx3" };
  if (s.schedule) return { label: "cron", cls: "border-acc/60 text-acc" };
  return { label: "空闲", cls: "border-line text-tx2" };
}

const RUN_BADGE: Record<PipeRunStatus, { label: string; cls: string }> = {
  running: { label: "running", cls: "border-warn/50 text-warn" },
  done: { label: "done", cls: "border-acc/60 text-acc" },
  failed: { label: "failed", cls: "border-err/50 text-err" },
};

const STEP_BADGE = {
  pending: { label: "pending", cls: "border-line text-tx3" },
  running: { label: "running", cls: "border-warn/50 text-warn" },
  done: { label: "done", cls: "border-acc/50 text-acc" },
  failed: { label: "failed", cls: "border-err/50 text-err" },
  skipped: { label: "skipped", cls: "border-line text-tx3" },
} as const;

/** 命令里的步骤：`名称` 或 `名称：指令`，用 > 分隔 */
function parseCommandSteps(src: string): { name: string; instruction?: string }[] {
  return src
    .split(/[>＞]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.split(/[：:]/);
      const name = (m.shift() ?? "").trim();
      const instruction = m.join("：").trim();
      return instruction ? { name, instruction } : { name };
    })
    .filter((s) => s.name);
}

/** 横向流水线视图：激光指向当前执行步，成功保持高亮，未执行灰色，出错红色指向。
 *  steps 来自 run.steps（含 pending/running/done/failed/skipped 实时状态）。 */
function PipelineTrack({ steps }: { steps: PipeRunDto["steps"] }) {
  // 激光指向：running 步为活动激光；全部 done 时指向最后一步；failed 时指向失败步（红色）
  const activeIdx = steps.findIndex((s) => s.status === "running");
  const failedIdx = steps.findIndex((s) => s.status === "failed");
  const laserIdx =
    failedIdx >= 0
      ? failedIdx
      : activeIdx >= 0
        ? activeIdx
        : steps.length > 0
          ? steps.length - 1
          : -1;

  return (
    <div className="overflow-x-auto px-3 py-3">
      <div className="flex min-w-max items-center gap-0">
        {steps.map((s, i) => {
          const isActive = i === laserIdx;
          const isFailed = s.status === "failed";
          const isDone = s.status === "done";
          const isRunning = s.status === "running";
          const isPending = s.status === "pending" || s.status === "skipped";

          // 节点着色：done 高亮(acc)，failed 红，running 警示色脉冲，pending 灰
          const nodeCls = isDone
            ? "border-acc bg-acc/15 text-acc shadow-[0_0_8px_var(--color-acc)]"
            : isFailed
              ? "border-err bg-err/15 text-err shadow-[0_0_8px_var(--color-err)]"
              : isRunning
                ? "border-warn bg-warn/15 text-warn"
                : "border-line bg-bg1 text-tx3";

          // 连接线着色：已通过的线段高亮，指向失败的线段红，未到达的灰
          const linkCls =
            i < laserIdx || (isDone && i <= laserIdx)
              ? "bg-acc/70"
              : isFailed && i === laserIdx
                ? "bg-err/70"
                : "bg-line";

          return (
            <div key={s.id} className="flex items-center">
              {/* 节点 */}
              <div className="relative flex flex-col items-center">
                {/* 激光指向：活动节点上方的发射光束 */}
                {isActive && (
                  <div className="absolute -top-3 flex flex-col items-center">
                    <div
                      className={`h-3 w-[2px] ${
                        isFailed ? "bg-err" : "bg-acc"
                      } ${isRunning ? "animate-pulse" : ""} shadow-[0_0_6px_currentColor]`}
                    />
                    <div
                      className={`h-1.5 w-1.5 rotate-45 border ${
                        isFailed ? "border-err bg-err" : "border-acc bg-acc"
                      } -mt-[3px]`}
                    />
                  </div>
                )}
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full border font-mono text-[11px] transition-all ${nodeCls} ${
                    isRunning ? "animate-pulse" : ""
                  }`}
                >
                  {isDone ? "✓" : isFailed ? "✗" : pad(i + 1)}
                </div>
                <span
                  className={`mt-1 max-w-[72px] truncate text-[10px] ${
                    isDone
                      ? "text-acc"
                      : isFailed
                        ? "text-err"
                        : isRunning
                          ? "text-warn"
                          : "text-tx3"
                  }`}
                >
                  {s.name}
                </span>
                <span className="text-[9px] text-tx3">
                  {isPending ? "—" : fmtDuration(s.durationMs)}
                </span>
              </div>
              {/* 连接线（最后一步之后不画） */}
              {i < steps.length - 1 && (
                <div className="mx-1 mb-8 h-[2px] w-8">
                  <div
                    className={`h-full w-full ${linkCls} ${
                      isRunning && i === laserIdx ? "animate-pulse" : ""
                    }`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 流水线工厂：SOP 编排 + 顺序执行 + 运行记录 —— 终端式 SOP 工厂 */
export default function PipePanel() {
  const role = useAuthStore((s) => s.user?.role ?? "guest");
  // 原型 ACL：~/pipe owner rw / member × / guest ×
  const canAccess = role === "owner";

  const [digest, setDigest] = useState<PipeDigestDto | null>(null);
  const [sops, setSops] = useState<PipeSopDto[]>([]);
  const [runs, setRuns] = useState<PipeRunDto[]>([]);

  const [selectedSopId, setSelectedSopId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [runInput, setRunInput] = useState("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cmd, setCmd] = useState("");
  const [cmdError, setCmdError] = useState<string | null>(null);

  // 步骤编辑器：editing=true 时步骤区变为表单
  const [editing, setEditing] = useState(false);
  const [draftSteps, setDraftSteps] = useState<{ name: string; instruction: string }[]>([]);
  const [draftModelId, setDraftModelId] = useState<string>("");
  const [models, setModels] = useState<ModelDto[]>([]);

  // 新建 SOP 弹窗（流水线组装台）：节点链可视化搭建
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newSchedule, setNewSchedule] = useState("");
  const [newModelId, setNewModelId] = useState("");
  const [newSteps, setNewSteps] = useState<{ name: string; instruction: string }[]>([
    { name: "", instruction: "" },
  ]);
  const [selNewStep, setSelNewStep] = useState(0);
  const [createError, setCreateError] = useState<string | null>(null);
  // 用 ref 记住当前选中项，避免 loadAll 重新加载后回退到全局最新运行
  const sopRef = useRef<string | null>(null);
  const runRef = useRef<string | null>(null);

  const loadAll = useCallback(
    async (prefer?: { sopId?: string | null; runId?: string | null }) => {
      if (!canAccess) {
        setLoading(false);
        return;
      }
      try {
        const [d, list, runList] = await Promise.all([
          api<PipeDigestDto>("/pipe/digest"),
          api<PipeSopDto[]>("/pipe/sops"),
          api<PipeRunDto[]>("/pipe/runs?limit=12"),
        ]);
        setDigest(d);
        setSops(list);
        setRuns(runList);
        setError(null);

        const wantSop = prefer?.sopId ?? sopRef.current;
        // 首次进入优先选中「有运行记录」的 SOP，右侧才能直接看到产出
        const nextSop =
          (wantSop && list.some((s) => s.id === wantSop) ? wantSop : null) ??
          list.find((s) => runList.some((r) => r.sopId === s.id))?.id ??
          list[0]?.id ??
          null;
        const wantRun = prefer?.runId ?? runRef.current;
        const nextRun =
          wantRun && runList.some((r) => r.id === wantRun)
            ? wantRun
            : runList.find((r) => r.sopId === nextSop)?.id ?? null;
        sopRef.current = nextSop;
        runRef.current = nextRun;
        setSelectedSopId(nextSop);
        setSelectedRunId(nextRun);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [canAccess],
  );

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // 编辑器需要可选模型列表：仅取对话类型且状态正常的模型
  useEffect(() => {
    if (!canAccess) return;
    api<ModelDto[]>("/models")
      .then((list) => setModels(list.filter((m) => m.kind === "chat" && m.status === "ok")))
      .catch(() => setModels([]));
  }, [canAccess]);

  const selectedSop = sops.find((s) => s.id === selectedSopId) ?? null;
  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;

  // 进入编辑：把当前 SOP 步骤拷贝为草稿，模型预填当前值
  const startEdit = () => {
    if (!selectedSop) return;
    setDraftSteps(selectedSop.steps.map((s) => ({ name: s.name, instruction: s.instruction ?? "" })));
    setDraftModelId(selectedSop.modelId ?? "");
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const updateDraftStep = (i: number, patch: Partial<{ name: string; instruction: string }>) =>
    setDraftSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const addDraftStep = (after: number) =>
    setDraftSteps((prev) => {
      const next = [...prev];
      next.splice(after + 1, 0, { name: "", instruction: "" });
      return next;
    });

  const removeDraftStep = (i: number) =>
    setDraftSteps((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  const moveDraftStep = (i: number, dir: -1 | 1) =>
    setDraftSteps((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  // 保存：名称去重校验后 PATCH，步骤顺序即表单顺序
  const saveEdit = async () => {
    if (!selectedSop) return;
    const cleaned = draftSteps.map((s) => ({ name: s.name.trim(), instruction: s.instruction.trim() }));
    if (cleaned.some((s) => !s.name)) {
      setError("步骤名称不能为空");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await api<PipeSopDto>(`/pipe/sops/${selectedSop.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          steps: cleaned.map((s) => (s.instruction ? { name: s.name, instruction: s.instruction } : s.name)),
          modelId: draftModelId || null,
        }),
      });
      setEditing(false);
      setNotice(`✓ 已保存 · ${next.stepCount} 步 · ${next.modelName ?? "model auto"}`);
      await loadAll({ sopId: next.id, runId: runRef.current });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // ── 新建 SOP 弹窗（流水线组装台）────────────────────────────
  const openCreate = () => {
    setNewName("");
    setNewDesc("");
    setNewSchedule("");
    setNewModelId("");
    setNewSteps([{ name: "", instruction: "" }]);
    setSelNewStep(0);
    setCreateError(null);
    setCreateOpen(true);
  };

  const updateNewStep = (i: number, patch: Partial<{ name: string; instruction: string }>) =>
    setNewSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  /** 在末尾追加节点并选中，节点链向右侧生长 */
  const appendNewStep = () =>
    setNewSteps((prev) => {
      setSelNewStep(prev.length);
      return [...prev, { name: "", instruction: "" }];
    });

  const removeNewStep = (i: number) =>
    setNewSteps((prev) => {
      if (prev.length <= 1) return prev;
      setSelNewStep((s) => (s >= prev.length - 1 ? prev.length - 2 : s > i ? s - 1 : s));
      return prev.filter((_, idx) => idx !== i);
    });

  const moveNewStep = (i: number, dir: -1 | 1) =>
    setNewSteps((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      setSelNewStep(j);
      return next;
    });

  const createSop = async () => {
    const name = newName.trim();
    const steps = newSteps.map((s) => ({ name: s.name.trim(), instruction: s.instruction.trim() }));
    if (!name) {
      setCreateError("SOP 名称不能为空");
      return;
    }
    if (steps.some((s) => !s.name)) {
      setCreateError("还有节点没有命名——点选后填写名称，或用 − 移除");
      return;
    }
    setBusy(true);
    setCreateError(null);
    try {
      const sop = await api<PipeSopDto>("/pipe/sops", {
        method: "POST",
        body: JSON.stringify({
          name,
          description: newDesc.trim() || undefined,
          schedule: newSchedule.trim() || undefined,
          modelId: newModelId || null,
          steps: steps.map((s) => (s.instruction ? s : s.name)),
        }),
      });
      setCreateOpen(false);
      setNotice(`✓ 已创建 SOP「${sop.name}」· ${sop.stepCount} 步`);
      await loadAll({ sopId: sop.id, runId: null });
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // 运行中轮询：选中 run 处于 running 时每 1.5s 拉一次最新进度，驱动流水线视图实时更新
  useEffect(() => {
    if (selectedRun?.status !== "running") return;
    const id = selectedRun.id;
    const timer = setInterval(() => {
      void api<PipeRunDto>(`/pipe/runs/${id}`)
        .then((fresh) => {
          setRuns((prev) => prev.map((r) => (r.id === id ? fresh : r)));
          // 运行结束（done/failed）后做一次全量刷新，更新左侧 runs 列表与 SOP 统计
          if (fresh.status !== "running") void loadAll({ sopId: fresh.sopId, runId: fresh.id });
        })
        .catch(() => undefined);
    }, 1500);
    return () => clearInterval(timer);
  }, [selectedRun?.status, selectedRun?.id, loadAll]);

  const visibleSops = sops.filter((s) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const chain = s.steps.map((x) => `${x.name} ${x.instruction}`).join(" ");
    return `${s.name}\n${s.description}\n${chain}`.toLowerCase().includes(q);
  });

  const selectSop = (sop: PipeSopDto) => {
    const latest = runs.find((r) => r.sopId === sop.id) ?? null;
    sopRef.current = sop.id;
    runRef.current = latest?.id ?? null;
    setSelectedSopId(sop.id);
    setSelectedRunId(latest?.id ?? null);
  };

  const describeRun = (run: PipeRunDto) =>
    run.status === "done"
      ? `✓ ${run.sopName} 完成 ${run.stepDone}/${run.stepTotal} · ${fmtDuration(run.durationMs)}`
      : `✗ ${run.sopName} 失败于第 ${Math.min(run.stepDone + 1, run.stepTotal)} 步 · ${run.error ?? "未知错误"}`;

  const runSopNow = async (sop: PipeSopDto, inputText?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const run = await api<PipeRunDto>(`/pipe/sops/${sop.id}/run`, {
        method: "POST",
        body: JSON.stringify({ input: inputText ?? "" }),
      });
      setSelectedSopId(run.sopId ?? sop.id);
      setSelectedRunId(run.id);
      setNotice(describeRun(run));
      await loadAll({ sopId: run.sopId, runId: run.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const retryRun = async (run: PipeRunDto) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await api<PipeRunDto>(`/pipe/runs/${run.id}/retry`, { method: "POST" });
      setSelectedSopId(next.sopId);
      setSelectedRunId(next.id);
      setNotice(describeRun(next));
      await loadAll({ sopId: next.sopId, runId: next.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 断点重试：从第 stepIndex 步（0-based）重跑，前序步骤复用上次产出 */
  const retryFromStep = async (run: PipeRunDto, stepIndex: number) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await api<PipeRunDto>(`/pipe/runs/${run.id}/retry-from`, {
        method: "POST",
        body: JSON.stringify({ fromStep: stepIndex }),
      });
      setSelectedSopId(next.sopId);
      setSelectedRunId(next.id);
      setNotice(`↻ 从第 ${stepIndex + 1} 步重跑 · ${describeRun(next)}`);
      await loadAll({ sopId: next.sopId, runId: next.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const togglePause = async (sop: PipeSopDto) => {
    const next: PipeSopStatus = sop.status === "paused" ? "idle" : "paused";
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api<PipeSopDto>(`/pipe/sops/${sop.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      setNotice(`✓ ${sop.name} → ${next === "paused" ? "已暂停" : "空闲"}`);
      await loadAll({ sopId: sop.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeSop = async (sop: PipeSopDto) => {
    if (!window.confirm(`删除 SOP「${sop.name}」？历史运行记录会保留。`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/pipe/sops/${sop.id}`, { method: "DELETE" });
      setNotice(`✓ 已删除 SOP「${sop.name}」`);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitCmd = async () => {
    const src = cmd.trim();
    if (!src || busy) return;
    setCmdError(null);
    setNotice(null);
    setError(null);
    setBusy(true);
    try {
      if (/^pipe\.run\b/i.test(src)) {
        const rest = src.replace(/^pipe\.run\s*/i, "");
        const [keyRaw, ...tail] = rest.split("|");
        const key = (keyRaw ?? "").trim();
        if (!key) {
          setCmdError("用法：pipe.run <SOP 名称> | <本次输入（可选）>");
          return;
        }
        const target =
          sops.find((s) => s.id === key) ?? sops.find((s) => s.name.includes(key));
        if (!target) {
          setCmdError(`未找到 SOP「${key}」`);
          return;
        }
        const input = tail.join("|").trim();
        const run = await api<PipeRunDto>(`/pipe/sops/${target.id}/run`, {
          method: "POST",
          body: JSON.stringify({ input }),
        });
        setCmd("");
        setNotice(describeRun(run));
        await loadAll({ sopId: run.sopId, runId: run.id });
      } else if (/^pipe\.new\b/i.test(src)) {
        const rest = src.replace(/^pipe\.new\s*/i, "");
        const [nameRaw, stepsRaw, ...tail] = rest.split("|");
        const name = (nameRaw ?? "").trim();
        const steps = parseCommandSteps(stepsRaw ?? "");
        if (!name || steps.length === 0) {
          setCmdError("用法：pipe.new <名称> | <步1 > 步2 > 步3> | <周期（可选）>");
          return;
        }
        const created = await api<PipeSopDto>("/pipe/sops", {
          method: "POST",
          body: JSON.stringify({ name, steps, schedule: tail.join("|").trim() || undefined }),
        });
        setCmd("");
        setNotice(`✓ 已创建 SOP「${created.name}」· ${created.stepCount} 步`);
        await loadAll({ sopId: created.id });
      } else {
        setCmdError("可用命令：pipe.run · pipe.new");
      }
    } catch (e) {
      setCmdError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!canAccess) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 font-mono text-[12px] text-tx3">
        <div className="text-err">403 · ~/pipe 仅 owner 可访问</div>
        <div>// 原型 ACL：owner rw · member × · guest ×</div>
        <div>// 流水线会批量调用模型并消耗额度，不对协作者与游客开放</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[12px] text-tx3">
        ⠋ 读取 ~/pipe/sops…
      </div>
    );
  }

  const kpis = [
    {
      k: "SOP 总数",
      v: `${digest?.sops ?? 0}`,
      d: `${digest?.active ?? 0} 条可用 · ${digest?.paused ?? 0} 条暂停`,
    },
    {
      k: "今日运行",
      v: `${digest?.runsToday ?? 0}`,
      d: `${digest?.running ?? 0} 条正在运行`,
    },
    {
      k: "成功率",
      v: `${digest?.successRate ?? 0}%`,
      d: `今日失败 ${digest?.failed ?? 0} 次`,
    },
    {
      k: "平均耗时",
      v: fmtDuration(digest?.avgDurationMs ?? 0),
      d: "今日成功运行的平均单次耗时",
    },
  ];

  return (
    <div className="mx-auto w-[min(1280px,97%)] py-6 font-mono">
      {/* 标题栏 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-tx3">~/pipeline — sop.factory</span>
          <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-tx3">
            {digest?.sops ?? 0} sops
          </span>
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] ${
              (digest?.runsToday ?? 0) > 0 ? "border-acc/50 text-acc" : "border-line text-tx3"
            }`}
          >
            {digest?.runsToday ?? 0} runs today
          </span>
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] ${
              (digest?.failed ?? 0) > 0 ? "border-err/50 text-err" : "border-line text-tx3"
            }`}
          >
            {digest?.failed ?? 0} failed
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <button
            className="rounded border border-line px-2 py-0.5 text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
            onClick={() => setCmd("pipe.new ")}
            disabled={busy}
          >
            新建 SOP
          </button>
          <button
            className="rounded border border-line px-2 py-0.5 text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
            onClick={() => void loadAll({ sopId: selectedSopId, runId: selectedRunId })}
            disabled={busy}
          >
            刷新
          </button>
        </div>
      </div>

      {/* 摘要 */}
      {digest && (
        <div className="mb-3 rounded-md border border-line bg-bg1 px-3 py-2 text-[11px] text-tx3">
          {digest.summary.split("·").map((part, i) =>
            i === 0 ? (
              <b key={i} className="font-medium text-acc">
                {part.trim()}
              </b>
            ) : (
              <span key={i}>{" · "}{part.trim()}</span>
            ),
          )}
        </div>
      )}

      {/* KPI */}
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {kpis.map((s) => (
          <div key={s.k} className="rounded-lg border border-line bg-bg1 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-tx3">{s.k}</div>
            <div className="mt-1 text-[20px] text-tx">{s.v}</div>
            <div className="mt-0.5 text-[10px] text-tx3">{s.d}</div>
          </div>
        ))}
      </div>

      {/* 命令栏 */}
      <form
        className="mb-3 rounded-md border border-dashed border-line px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submitCmd();
        }}
      >
        <div className="flex items-center gap-2 text-[12px]">
          <span className="text-acc">▸</span>
          <input
            className="min-w-0 flex-1 bg-transparent text-tx outline-none placeholder:text-tx3"
            placeholder="pipe.run 漫剧生成 | 《赛博夜行》第 4 集   /   pipe.new 播客脚本 | 选题 > 大纲 > 口播稿 | 每周三 10:00"
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
          // pipe.run SOP | 本次输入 · pipe.new 名称 | 步1 &gt; 步2 | 周期
        </div>
        {cmdError && <div className="mt-1 text-[11px] text-err">✗ {cmdError}</div>}
      </form>

      {notice && <div className="mb-2 text-[11px] text-acc">{notice}</div>}
      {error && (
        <div className="mb-2 rounded border border-err/50 bg-bg1 px-3 py-2 text-[12px] text-err">
          ✗ {error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* 左：SOP 卡片 + 最近运行 */}
        <div className="flex min-w-0 flex-col gap-3">
          <div className="overflow-hidden rounded-lg border border-line bg-bg1">
            <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[10.5px] text-tx3">
              <span>~/pipe/sops</span>
              <span className="flex items-center gap-2">
                <span>
                  {visibleSops.length} shown · {sops.length} total
                </span>
                <button
                  className="rounded border border-acc/60 px-1.5 py-[1px] text-[9.5px] text-acc hover:bg-acc/10"
                  onClick={openCreate}
                  title="可视化组装一条流水线"
                >
                  + 新建
                </button>
              </span>
            </div>
            <div className="p-2">
              <input
                className="w-full rounded border border-line bg-bg px-2 py-1 text-[11px] text-tx outline-none placeholder:text-tx3 focus:border-acc"
                placeholder="grep SOP 名称 / 描述 / 步骤…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {visibleSops.length === 0 ? (
              <div className="px-4 py-10 text-center text-[11px] text-tx3">
                {sops.length === 0
                  ? "// 还没有 SOP —— 点右上角「新建 SOP」编排第一条生产链路"
                  : "// 当前过滤条件没有匹配的 SOP"}
              </div>
            ) : (
              <div className="grid gap-2 p-2">
                {visibleSops.map((s) => {
                  const badge = sopBadge(s);
                  return (
                    <button
                      key={s.id}
                      className={`rounded-md border px-2.5 py-2 text-left transition-colors hover:border-acc/70 ${
                        s.id === selectedSopId
                          ? "border-acc/60 bg-bg2"
                          : "border-line bg-bg1"
                      }`}
                      onClick={() => selectSop(s)}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[12px] text-tx">
                          <span className="text-acc">▸</span> {s.name}
                        </span>
                        <span
                          className={`flex-none rounded border px-1.5 py-[1px] text-[9.5px] ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-[10.5px] text-tx3">
                        {s.steps.map((x) => x.name).join(" → ")}
                      </div>
                      <div className="mt-1 text-[10px] text-tx3">
                        <b className="font-medium text-tx2">{s.stepCount}</b> 步 ·{" "}
                        <b className="font-medium text-tx2">{s.runCount}</b> 次 · 均{" "}
                        <b className="font-medium text-tx2">
                          {s.avgDurationMs ? fmtDuration(s.avgDurationMs) : "—"}
                        </b>
                        {s.schedule && <span> · {s.schedule}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-line bg-bg1">
            <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[10.5px] text-tx3">
              <span>~/pipe/runs — last {runs.length}</span>
              <span>{runs.filter((r) => r.status === "failed").length} failed</span>
            </div>
            {runs.length === 0 ? (
              <div className="px-4 py-10 text-center text-[11px] text-tx3">
                // 还没有运行记录 —— 选中一条 SOP 点「运行」
              </div>
            ) : (
              <div className="max-h-[300px] overflow-y-auto">
                {runs.map((r) => {
                  const badge = RUN_BADGE[r.status];
                  return (
                    <button
                      key={r.id}
                      className={`block w-full border-b border-l-2 border-line px-3 py-2 text-left last:border-b-0 hover:bg-bg2 ${
                        r.id === selectedRunId
                          ? "border-l-acc bg-bg2"
                          : "border-l-transparent"
                      }`}
                      onClick={() => {
                        runRef.current = r.id;
                        if (r.sopId) sopRef.current = r.sopId;
                        setSelectedRunId(r.id);
                        if (r.sopId) setSelectedSopId(r.sopId);
                      }}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[11.5px] text-tx">
                          {fmtDay(r.startedAt)} {fmtClock(r.startedAt)} · {r.sopName}
                        </span>
                        <span
                          className={`flex-none rounded border px-1.5 py-[1px] text-[9.5px] ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-tx3">
                        <span>
                          {r.stepDone}/{r.stepTotal} 步 · {fmtDuration(r.durationMs)}
                        </span>
                        <span className="truncate pl-2">
                          {r.error ?? oneLine(r.output, 40)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 右：SOP 详情 + 运行明细 */}
        <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-bg1">
          {!selectedSop ? (
            <div className="flex flex-1 items-center justify-center px-4 py-16 text-center text-[11px] text-tx3">
              // 选择左侧 SOP 查看步骤编排
            </div>
          ) : (
            <>
              <div className="border-b border-line px-3 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13px] text-tx">
                    <span className="text-acc">▸</span> {selectedSop.name}
                  </span>
                  <span
                    className={`rounded border px-1.5 py-[1px] text-[9.5px] ${sopBadge(selectedSop).cls}`}
                  >
                    {sopBadge(selectedSop).label}
                  </span>
                </div>
                <div className="mt-1 text-[10.5px] text-tx3">
                  {selectedSop.stepCount} 步 · 累计 {selectedSop.runCount} 次 · 成功{" "}
                  {selectedSop.successCount}
                  {selectedSop.modelName ? ` · model ${selectedSop.modelName}` : " · model auto"}
                  {selectedSop.schedule ? ` · ${selectedSop.schedule}` : ""}
                </div>
                {selectedSop.description && (
                  <div className="mt-1 text-[11px] text-tx2">{selectedSop.description}</div>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
                  <input
                    className="min-w-[160px] flex-1 rounded border border-line bg-bg px-2 py-1 text-[11px] text-tx outline-none placeholder:text-tx3 focus:border-acc"
                    placeholder="本次输入 · 主题 / 素材 / 集数…"
                    value={runInput}
                    onChange={(e) => setRunInput(e.target.value)}
                  />
                  <button
                    className="rounded border border-acc/60 px-2 py-1 text-acc hover:bg-acc/10 disabled:opacity-40"
                    onClick={() => void runSopNow(selectedSop, runInput)}
                    disabled={busy || selectedSop.status !== "idle"}
                  >
                    {busy ? "⠋ 运行中" : "▸ 运行"}
                  </button>
                  <button
                    className="rounded border border-line px-2 py-1 text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
                    onClick={() => void togglePause(selectedSop)}
                    disabled={busy || selectedSop.status === "running"}
                  >
                    {selectedSop.status === "paused" ? "恢复" : "暂停"}
                  </button>
                  <button
                    className="rounded border border-line px-2 py-1 text-tx3 hover:border-err hover:text-err disabled:opacity-40"
                    onClick={() => void removeSop(selectedSop)}
                    disabled={busy || selectedSop.status === "running"}
                  >
                    × 删除
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[10.5px] text-tx3">
                <span>~/pipe/sops/{selectedSop.name}/steps</span>
                <span className="flex items-center gap-2">
                  <span>{editing ? draftSteps.length : selectedSop.steps.length} steps</span>
                  {!editing ? (
                    <button
                      className="rounded border border-line px-1.5 py-[1px] text-[9.5px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
                      onClick={startEdit}
                      disabled={busy || selectedSop.status === "running"}
                      title="编辑步骤编排"
                    >
                      ✎ 编辑
                    </button>
                  ) : (
                    <>
                      <button
                        className="rounded border border-acc/60 px-1.5 py-[1px] text-[9.5px] text-acc hover:bg-acc/10 disabled:opacity-40"
                        onClick={() => void saveEdit()}
                        disabled={busy}
                      >
                        ✓ 保存
                      </button>
                      <button
                        className="rounded border border-line px-1.5 py-[1px] text-[9.5px] text-tx3 hover:border-err hover:text-err disabled:opacity-40"
                        onClick={cancelEdit}
                        disabled={busy}
                      >
                        × 取消
                      </button>
                    </>
                  )}
                </span>
              </div>

              {!editing ? (
                /* 查看模式：只读步骤列表 */
                <div className="border-b border-line px-3 py-2">
                  {selectedSop.steps.map((s, i) => (
                    <div key={s.id} className="flex gap-2 py-0.5 text-[11px]">
                      <span className="flex-none text-tx3">{pad(i + 1)}</span>
                      <span className="flex-none text-tx2">{s.name}</span>
                      {s.instruction && (
                        <span className="min-w-0 truncate text-[10.5px] text-tx3">
                          // {s.instruction}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                /* 编辑模式：步骤表单（增删改 + 上下移 + 每步指令）+ SOP 模型选择 */
                <div className="border-b border-line px-3 py-2">
                  {draftSteps.map((s, i) => (
                    <div key={i} className="mb-1.5 flex items-start gap-1.5">
                      <div className="flex flex-none flex-col pt-1">
                        <button
                          className="text-[9px] leading-none text-tx3 hover:text-acc disabled:opacity-30"
                          onClick={() => moveDraftStep(i, -1)}
                          disabled={busy || i === 0}
                          title="上移"
                        >
                          ▲
                        </button>
                        <button
                          className="mt-0.5 text-[9px] leading-none text-tx3 hover:text-acc disabled:opacity-30"
                          onClick={() => moveDraftStep(i, 1)}
                          disabled={busy || i === draftSteps.length - 1}
                          title="下移"
                        >
                          ▼
                        </button>
                      </div>
                      <span className="flex-none pt-1.5 text-tx3">{pad(i + 1)}</span>
                      <div className="min-w-0 flex-1">
                        <input
                          className="w-full rounded border border-line bg-bg px-2 py-1 text-[11px] text-tx outline-none placeholder:text-tx3 focus:border-acc"
                          placeholder="步骤名称"
                          value={s.name}
                          onChange={(e) => updateDraftStep(i, { name: e.target.value })}
                        />
                        <input
                          className="mt-1 w-full rounded border border-line bg-bg px-2 py-1 text-[10.5px] text-tx2 outline-none placeholder:text-tx3 focus:border-acc"
                          placeholder="指令（可选）：这一步具体要模型做什么"
                          value={s.instruction}
                          onChange={(e) => updateDraftStep(i, { instruction: e.target.value })}
                        />
                      </div>
                      <div className="flex flex-none flex-col gap-1 pt-1">
                        <button
                          className="rounded border border-line px-1 text-[10px] text-tx3 hover:border-acc hover:text-acc disabled:opacity-30"
                          onClick={() => addDraftStep(i)}
                          disabled={busy}
                          title="在此步之后插入新步骤"
                        >
                          +
                        </button>
                        <button
                          className="rounded border border-line px-1 text-[10px] text-tx3 hover:border-err hover:text-err disabled:opacity-30"
                          onClick={() => removeDraftStep(i)}
                          disabled={busy || draftSteps.length <= 1}
                          title="删除此步"
                        >
                          −
                        </button>
                      </div>
                    </div>
                  ))}

                  <div className="mt-2 flex items-center gap-2 border-t border-line pt-2 text-[10.5px]">
                    <span className="flex-none text-tx3">model</span>
                    <select
                      className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 text-[11px] text-tx outline-none focus:border-acc"
                      value={draftModelId}
                      onChange={(e) => setDraftModelId(e.target.value)}
                    >
                      <option value="">auto（按 status=ok 优先挑选）</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.modelName} · {m.provider}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {selectedRun ? (
                <>
                  <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[10.5px] text-tx3">
                    <span>
                      run #{selectedRun.id.slice(0, 6)} · {fmtDay(selectedRun.startedAt)}{" "}
                      {fmtClock(selectedRun.startedAt)}
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded border px-1.5 py-[1px] text-[9.5px] ${RUN_BADGE[selectedRun.status].cls}`}
                      >
                        {RUN_BADGE[selectedRun.status].label}
                      </span>
                      {selectedRun.status === "failed" && (
                        <button
                          className="rounded border border-line px-1.5 py-[1px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
                          onClick={() => void retryRun(selectedRun)}
                          disabled={busy}
                        >
                          ↻ 重试
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="border-b border-line px-3 py-2 text-[10.5px] text-tx3">
                    {selectedRun.input ? (
                      <span>input: {selectedRun.input}</span>
                    ) : (
                      <span className="text-tx3">input: （无）</span>
                    )}
                    <span className="ml-2">
                      {" · "}
                      {selectedRun.stepDone}/{selectedRun.stepTotal} 步 ·{" "}
                      {fmtDuration(selectedRun.durationMs)}
                    </span>
                    {selectedRun.status === "running" && (
                      <span className="ml-2 animate-pulse text-warn">● 执行中</span>
                    )}
                  </div>

                  {/* 横向流水线视图：激光指向当前步，成功高亮 / 未执行灰 / 出错红 */}
                  {selectedRun.steps.length > 0 && (
                    <div className="border-b border-line">
                      <PipelineTrack steps={selectedRun.steps} />
                    </div>
                  )}

                  <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                    {selectedRun.steps.length === 0 ? (
                      <div className="py-8 text-center text-[11px] text-tx3">// 无步骤明细</div>
                    ) : (
                      selectedRun.steps.map((s) => {
                        const badge = STEP_BADGE[s.status];
                        return (
                          <div key={s.id} className="border-b border-line/60 py-1.5 last:border-b-0">
                            <div className="flex items-baseline justify-between gap-2 text-[11px]">
                              <span className="text-tx2">
                                <span className="text-tx3">{pad(s.index + 1)}</span> {s.name}
                              </span>
                              <span className="flex items-center gap-2">
                                <span className="text-[10px] text-tx3">
                                  {s.status === "skipped" ? "—" : fmtDuration(s.durationMs)}
                                </span>
                                <span
                                  className={`rounded border px-1.5 py-[1px] text-[9.5px] ${badge.cls}`}
                                >
                                  {badge.label}
                                </span>
                                {/* 断点重试：run 已结束时，从该步重跑（前序步复用产出）。
                                    只在失败步及之后可重跑；首步重跑等价整 run 重试。 */}
                                {selectedRun.status !== "running" &&
                                  s.index >= selectedRun.stepDone && (
                                    <button
                                      className="rounded border border-line px-1.5 py-[1px] text-[9.5px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
                                      onClick={() => void retryFromStep(selectedRun, s.index)}
                                      disabled={busy}
                                      title={`从第 ${s.index + 1} 步重跑，前 ${s.index} 步复用上次产出`}
                                    >
                                      ↻ 从此步重跑
                                    </button>
                                  )}
                              </span>
                            </div>
                            {(s.output || s.error) && (
                              <div
                                className={`mt-1 max-h-[120px] overflow-y-auto whitespace-pre-wrap break-words rounded border border-line/60 bg-bg px-2 py-1 text-[10.5px] ${
                                  s.error ? "text-err" : "text-tx3"
                                }`}
                              >
                                {s.error ?? s.output}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>

                  {selectedRun.output && (
                    <div className="border-t border-line px-3 py-2">
                      <div className="mb-1 text-[10px] text-tx3">// 最终产出</div>
                      <div className="max-h-[120px] overflow-y-auto text-[11px] text-tx">
                        <MarkdownText text={selectedRun.output} />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center px-4 py-12 text-center text-[11px] text-tx3">
                  // 还没有运行记录 —— 点上方「▸ 运行」跑一次
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 新建 SOP 弹窗：流水线组装台 —— 横向节点链搭建，风格与 mail.compose 一致 */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCreateOpen(false);
          }}
        >
          <div className="max-h-[90vh] w-[min(720px,96%)] overflow-y-auto rounded-lg border border-line bg-bg1 shadow-2xl">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[11px]">
              <span className="text-acc">▸</span>
              <span className="text-tx2">pipe.new</span>
              <span className="text-tx3">// 组装一条流水线 · 节点按序执行，产出逐级传递</span>
              <button
                className="ml-auto rounded border border-line px-1.5 py-0.5 text-[10px] text-tx3 hover:border-err hover:text-err"
                onClick={() => setCreateOpen(false)}
                title="关闭"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 px-4 py-3 text-[11.5px]">
              <div className="grid gap-2 md:grid-cols-2">
                <label className="flex items-center gap-2">
                  <span className="w-[52px] flex-none text-right text-[10.5px] text-tx3">name:</span>
                  <input
                    className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 text-[11px] text-tx outline-none placeholder:text-tx3 focus:border-acc"
                    placeholder="公众号日更流水线"
                    value={newName}
                    onChange={(e) => {
                      setNewName(e.target.value);
                      setCreateError(null);
                    }}
                    autoFocus
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-[52px] flex-none text-right text-[10.5px] text-tx3">model:</span>
                  <select
                    className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 text-[11px] text-tx outline-none focus:border-acc"
                    value={newModelId}
                    onChange={(e) => setNewModelId(e.target.value)}
                  >
                    <option value="">auto（按 status=ok 优先挑选）</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.modelName} · {m.provider}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="flex items-center gap-2">
                  <span className="w-[52px] flex-none text-right text-[10.5px] text-tx3">desc:</span>
                  <input
                    className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 text-[11px] text-tx outline-none placeholder:text-tx3 focus:border-acc"
                    placeholder="（可选）这条流水线做什么"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-[52px] flex-none text-right text-[10.5px] text-tx3">cron:</span>
                  <input
                    className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 text-[11px] text-tx outline-none placeholder:text-tx3 focus:border-acc"
                    placeholder="（可选）如 每周五 16:00"
                    value={newSchedule}
                    onChange={(e) => setNewSchedule(e.target.value)}
                  />
                </label>
              </div>

              {/* 节点链搭建器：横向可视化，点选节点后在下方编辑 */}
              <div>
                <div className="mb-1 text-[10px] text-tx3">
                  // 节点链 · 点选节点编辑，尾端 ⊕ 追加，产出沿箭头传递
                </div>
                <div className="overflow-x-auto rounded border border-line bg-bg px-3 py-3">
                  <div className="flex min-w-max items-center gap-0">
                    {newSteps.map((s, i) => {
                      const selected = i === selNewStep;
                      const named = s.name.trim().length > 0;
                      return (
                        <div key={i} className="flex items-center">
                          <button
                            className={`flex h-9 min-w-9 items-center justify-center rounded-full border px-2 font-mono text-[10.5px] transition-all ${
                              selected
                                ? "border-acc bg-acc/15 text-acc shadow-[0_0_8px_var(--color-acc)]"
                                : named
                                  ? "border-line bg-bg1 text-tx2 hover:border-acc/60"
                                  : "border-dashed border-line bg-bg1 text-tx3 hover:border-acc/60"
                            }`}
                            onClick={() => setSelNewStep(i)}
                            title={s.name.trim() || `节点 ${i + 1}（未命名）`}
                          >
                            {s.name.trim() || pad(i + 1)}
                          </button>
                          {/* 箭头连接 */}
                          <div className="mx-1 flex items-center text-tx3">
                            <div className="h-[2px] w-5 bg-line" />
                            <span className="-ml-[2px] text-[8px]">▸</span>
                          </div>
                        </div>
                      );
                    })}
                    {/* 尾端追加节点 */}
                    <button
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-acc/60 text-acc hover:bg-acc/10"
                      onClick={appendNewStep}
                      title="追加一个节点"
                    >
                      ⊕
                    </button>
                  </div>
                </div>
              </div>

              {/* 选中节点的编辑区 */}
              <div className="rounded border border-line bg-bg px-3 py-2.5">
                <div className="mb-2 flex items-center justify-between text-[10px] text-tx3">
                  <span>
                    节点 {pad(selNewStep + 1)} / {newSteps.length}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <button
                      className="rounded border border-line px-1.5 py-[1px] text-[9.5px] text-tx3 hover:border-acc hover:text-acc disabled:opacity-30"
                      onClick={() => moveNewStep(selNewStep, -1)}
                      disabled={busy || selNewStep === 0}
                      title="左移"
                    >
                      ← 左移
                    </button>
                    <button
                      className="rounded border border-line px-1.5 py-[1px] text-[9.5px] text-tx3 hover:border-acc hover:text-acc disabled:opacity-30"
                      onClick={() => moveNewStep(selNewStep, 1)}
                      disabled={busy || selNewStep === newSteps.length - 1}
                      title="右移"
                    >
                      右移 →
                    </button>
                    <button
                      className="rounded border border-line px-1.5 py-[1px] text-[9.5px] text-tx3 hover:border-err hover:text-err disabled:opacity-30"
                      onClick={() => removeNewStep(selNewStep)}
                      disabled={busy || newSteps.length <= 1}
                      title="移除该节点"
                    >
                      − 移除
                    </button>
                  </span>
                </div>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2">
                    <span className="w-[52px] flex-none text-right text-[10.5px] text-tx3">step:</span>
                    <input
                      className="min-w-0 flex-1 rounded border border-line bg-bg1 px-2 py-1 text-[11px] text-tx outline-none placeholder:text-tx3 focus:border-acc"
                      placeholder="节点名称，如 选题 / 大纲 / 初稿"
                      value={newSteps[selNewStep]?.name ?? ""}
                      onChange={(e) => {
                        updateNewStep(selNewStep, { name: e.target.value });
                        setCreateError(null);
                      }}
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="w-[52px] flex-none text-right text-[10.5px] text-tx3">instr:</span>
                    <input
                      className="min-w-0 flex-1 rounded border border-line bg-bg1 px-2 py-1 text-[10.5px] text-tx2 outline-none placeholder:text-tx3 focus:border-acc"
                      placeholder="（可选）这一步具体要模型做什么"
                      value={newSteps[selNewStep]?.instruction ?? ""}
                      onChange={(e) => updateNewStep(selNewStep, { instruction: e.target.value })}
                    />
                  </label>
                </div>
              </div>

              {createError && <div className="text-[10.5px] text-err">✗ {createError}</div>}

              <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
                <button
                  className="rounded border border-line px-3 py-1 text-[11px] text-tx3 hover:border-err hover:text-err disabled:opacity-40"
                  onClick={() => setCreateOpen(false)}
                  disabled={busy}
                >
                  取消
                </button>
                <button
                  className="rounded border border-acc/60 px-3 py-1 text-[11px] text-acc hover:bg-acc/10 disabled:opacity-40"
                  onClick={() => void createSop()}
                  disabled={busy}
                >
                  {busy ? "⠋ 创建中" : "▸ 创建流水线"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
