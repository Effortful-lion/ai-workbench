import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PipeDigestDto,
  PipeRunDto,
  PipeRunStatus,
  PipeSopDto,
  PipeSopStatus,
} from "@aiwb/shared";
import { api } from "../../lib/api";
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

  const selectedSop = sops.find((s) => s.id === selectedSopId) ?? null;
  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;

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
              <span>
                {visibleSops.length} shown · {sops.length} total
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
                <span>{selectedSop.steps.length} steps</span>
              </div>

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
                  </div>

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
                      <div className="max-h-[120px] overflow-y-auto whitespace-pre-wrap break-words text-[11px] text-tx">
                        {selectedRun.output}
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
    </div>
  );
}
