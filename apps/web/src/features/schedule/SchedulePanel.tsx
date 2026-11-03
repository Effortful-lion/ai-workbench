import { useCallback, useEffect, useMemo, useState } from "react";
import type { ScheduleTaskDto, TaskPriority, TaskStatus } from "@aiwb/shared";
import { api } from "../../lib/api";
import { useAuthStore } from "../../stores/auth";

/** 时间线可视范围：08:00 – 21:00，每小时 44px */
const START_HOUR = 8;
const END_HOUR = 21;
const HOUR_PX = 44;
const MAX_MIN = (END_HOUR - START_HOUR) * 60;

const PRIORITY_LABEL: Record<TaskPriority, string> = { low: "低", normal: "普通", high: "高" };
const PRIORITY_CLASS: Record<TaskPriority, string> = {
  low: "border-line text-tx3",
  normal: "border-line text-tx2",
  high: "border-acc/60 text-acc",
};

const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtHM = (ts: number) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtMD = (ts: number) => {
  const d = new Date(ts);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay(); // 0=周日
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(x.getFullYear(), x.getMonth(), x.getDate() + diff);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

interface Placed {
  task: ScheduleTaskDto;
  top: number;
  height: number;
  lane: number;
  lanes: number;
}

/** 把一天的任务换算成时间线坐标，简单贪心分道避免完全遮挡 */
function layoutDay(tasks: ScheduleTaskDto[], dayStart: number): Placed[] {
  const placed: Placed[] = [];
  for (const t of tasks) {
    const startMin = (t.startsAt - dayStart) / 60000 - START_HOUR * 60;
    const endMin = (t.endsAt - dayStart) / 60000 - START_HOUR * 60;
    if (endMin <= 0 || startMin >= MAX_MIN) continue;
    const s = Math.max(0, startMin);
    const e = Math.min(MAX_MIN, endMin);
    placed.push({
      task: t,
      top: (s / 60) * HOUR_PX,
      height: Math.max(18, ((e - s) / 60) * HOUR_PX),
      lane: 0,
      lanes: 1,
    });
  }
  placed.sort((a, b) => a.top - b.top || a.height - b.height);
  const laneEnds: number[] = [];
  for (const p of placed) {
    let lane = laneEnds.findIndex((end) => end <= p.top);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = p.top + p.height;
    p.lane = lane;
  }
  const lanes = Math.max(1, laneEnds.length);
  for (const p of placed) p.lanes = lanes;
  return placed;
}

/** task.new <时间> <标题> [时长] [#high|#low] [@地点]
 *  时间支持 10:00 / 今天 10:00 / 明天 09:30 / 2026-11-03 14:00
 */
function parseTaskNew(raw: string): {
  error?: string;
  title?: string;
  startsAt?: number;
  durationMin?: number;
  priority?: TaskPriority;
  location?: string;
} {
  const src = raw.replace(/^task\.new\s*/i, "").trim();
  if (!src) return { error: "用法：task.new <时间> <标题> [时长] [#high|#low] [@地点]" };

  const tokens = src.split(/\s+/);
  const today = new Date();
  let day = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const first = tokens[0] ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(first)) {
    const [y, m, d] = first.split("-").map(Number);
    const parsed = new Date(y, m - 1, d);
    if (parsed.getMonth() !== m - 1 || parsed.getDate() !== d) {
      return { error: "日期不合法，应为 YYYY-MM-DD" };
    }
    day = parsed;
    tokens.shift();
  } else if (/^(今天|今日|today)$/i.test(first)) {
    tokens.shift();
  } else if (/^(明天|明日|tomorrow)$/i.test(first)) {
    day = addDays(day, 1);
    tokens.shift();
  }

  const timeStr = tokens.shift() ?? "";
  const tm = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!tm) return { error: "缺少开始时间，如 10:00 或 明天 09:30" };
  const hh = Number(tm[1]);
  const mm = Number(tm[2]);
  if (hh > 23 || mm > 59) return { error: "时间不合法，应为 HH:MM" };

  let durationMin: number | undefined;
  let priority: TaskPriority | undefined;
  let location: string | undefined;

  const rest: string[] = [];
  for (const tk of tokens) {
    const dur = tk.match(/^\[(\d+)\]$/)?.[1] ?? tk.match(/^(\d+)m$/i)?.[1];
    if (dur) {
      durationMin = Number(dur);
      continue;
    }
    const pr = tk.match(/^#(low|normal|high)$/i)?.[1];
    if (pr) {
      priority = pr.toLowerCase() as TaskPriority;
      continue;
    }
    if (tk.startsWith("@") && tk.length > 1) {
      location = tk.slice(1);
      continue;
    }
    rest.push(tk);
  }

  const title = rest.join(" ").trim();
  if (!title) return { error: "缺少任务标题" };
  const startsAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm).getTime();
  return { title, startsAt, durationMin, priority, location };
}

/** 可视化表单草稿：id=null 表示新建，否则为编辑 */
interface Draft {
  id: string | null;
  title: string;
  date: string;
  time: string;
  durationMin: number;
  priority: TaskPriority;
  location: string;
  notes: string;
}

/** 日程管理：周视图时间线 + 任务提醒清单 */
export default function SchedulePanel() {
  const role = useAuthStore((s) => s.user?.role ?? "guest");
  // 与原型 ACL 一致：owner rw，member ro；服务端 schedule:read / schedule:write 兜底
  const canWrite = role === "owner";

  const [tasks, setTasks] = useState<ScheduleTaskDto[]>([]);
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cmd, setCmd] = useState("");
  const [cmdError, setCmdError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const reload = useCallback(async () => {
    try {
      setTasks(await api<ScheduleTaskDto[]>("/schedule/tasks"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  const weekTasks = useMemo(
    () =>
      tasks.filter((t) => t.startsAt >= weekStart.getTime() && t.startsAt < weekEnd.getTime()),
    [tasks, weekStart, weekEnd],
  );

  const pendingCount = tasks.filter((t) => t.status === "pending").length;
  const todayKey = dateKey(new Date(now));

  const byDay = useMemo(() => {
    const map = new Map<string, ScheduleTaskDto[]>();
    for (const t of weekTasks) {
      const key = dateKey(new Date(t.startsAt));
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  }, [weekTasks]);

  const overlapping = useMemo(() => {
    let count = 0;
    for (const d of weekDays) {
      const list = [...(byDay.get(dateKey(d)) ?? [])].sort((a, b) => a.startsAt - b.startsAt);
      let maxEnd = 0;
      for (const t of list) {
        if (t.startsAt < maxEnd) count += 1;
        maxEnd = Math.max(maxEnd, t.endsAt);
      }
    }
    return count;
  }, [byDay, weekDays]);

  const reminders = useMemo(() => {
    const soon = now + 60 * 60 * 1000;
    return tasks
      .filter((t) => t.status === "pending")
      .filter(
        (t) =>
          t.startsAt < now || // 已过期
          (t.remindAt !== null && t.remindAt <= now && t.endsAt > now) || // 提醒到点
          (t.startsAt >= now && t.startsAt <= soon), // 一小时内
      )
      .sort((a, b) => {
        const aLate = a.startsAt < now;
        const bLate = b.startsAt < now;
        if (aLate !== bLate) return aLate ? -1 : 1;
        return aLate ? b.startsAt - a.startsAt : a.startsAt - b.startsAt;
      })
      .slice(0, 3);
  }, [tasks, now]);

  const listTasks = useMemo(() => {
    const rank: Record<TaskStatus, number> = { pending: 0, done: 1, canceled: 2 };
    return [...tasks].sort(
      (a, b) => rank[a.status] - rank[b.status] || a.startsAt - b.startsAt,
    );
  }, [tasks]);

  const shiftWeek = (delta: number) => setWeekStart((d) => addDays(d, delta * 7));

  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  /** 打开新建表单；从时间格点击时带入日期与时间 */
  const openCreate = (day?: Date, hour = 9, minute = 0) => {
    setDraft({
      id: null,
      title: "",
      date: dateKey(day ?? weekStart),
      time: `${pad(hour)}:${pad(minute)}`,
      durationMin: 60,
      priority: "normal",
      location: "",
      notes: "",
    });
    setCmdError(null);
    setNotice(null);
  };

  const openEdit = (t: ScheduleTaskDto) => {
    const d = new Date(t.startsAt);
    setDraft({
      id: t.id,
      title: t.title,
      date: dateKey(d),
      time: fmtHM(t.startsAt),
      durationMin: t.durationMin,
      priority: t.priority,
      location: t.location,
      notes: t.notes,
    });
    setCmdError(null);
    setNotice(null);
  };

  const saveDraft = async () => {
    if (!draft || busy) return;
    const title = draft.title.trim();
    if (!title) {
      setCmdError("标题不能为空");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !/^\d{2}:\d{2}$/.test(draft.time)) {
      setCmdError("日期或时间格式不正确");
      return;
    }
    const [y, m, d] = draft.date.split("-").map(Number);
    const [hh, mm] = draft.time.split(":").map(Number);
    if (hh > 23 || mm > 59) {
      setCmdError("时间需为 00:00–23:59");
      return;
    }
    if (!Number.isInteger(draft.durationMin) || draft.durationMin < 5 || draft.durationMin > 1440) {
      setCmdError("时长需为 5–1440 分钟");
      return;
    }
    const startsAt = new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
    if (!Number.isFinite(startsAt)) {
      setCmdError("日期不合法");
      return;
    }
    setBusy(true);
    setCmdError(null);
    setError(null);
    try {
      const payload = {
        title,
        startsAt,
        durationMin: draft.durationMin,
        priority: draft.priority,
        location: draft.location.trim(),
        notes: draft.notes.trim(),
        remindAt: startsAt - 10 * 60 * 1000,
      };
      const t = draft.id
        ? await api<ScheduleTaskDto>(`/schedule/tasks/${draft.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : await api<ScheduleTaskDto>("/schedule/tasks", {
            method: "POST",
            body: JSON.stringify(payload),
          });
      setDraft(null);
      setSelectedId(t.id);
      setWeekStart(startOfWeek(new Date(t.startsAt)));
      setNotice(`✓ ${draft.id ? "已更新" : "已排入日程"} ${fmtMD(t.startsAt)} ${fmtHM(t.startsAt)} ${t.title}`);
      await reload();
    } catch (e) {
      setCmdError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitCmd = async () => {
    const src = cmd.trim();
    if (!src || busy) return;
    setCmdError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (!/^task\.new\b/i.test(src)) {
        setCmdError("可用命令：task.new <时间> <标题> [时长] [#high|#low] [@地点]");
        return;
      }
      const parsed = parseTaskNew(src);
      if (parsed.error) {
        setCmdError(parsed.error);
        return;
      }
      const t = await api<ScheduleTaskDto>("/schedule/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: parsed.title,
          startsAt: parsed.startsAt,
          durationMin: parsed.durationMin,
          priority: parsed.priority,
          location: parsed.location,
        }),
      });
      setCmd("");
      setSelectedId(t.id);
      setWeekStart(startOfWeek(new Date(t.startsAt)));
      setNotice(`✓ ${fmtMD(t.startsAt)} ${fmtHM(t.startsAt)} ${t.title} 已排入日程`);
      await reload();
    } catch (e) {
      setCmdError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (task: ScheduleTaskDto, status: TaskStatus) => {
    try {
      const t = await api<ScheduleTaskDto>(`/schedule/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x)));
      setNotice(
        `✓ ${t.title} → ${status === "done" ? "已完成" : status === "canceled" ? "已取消" : "待办"}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeTask = async (task: ScheduleTaskDto) => {
    if (!window.confirm(`删除任务「${task.title}」？`)) return;
    try {
      await api(`/schedule/tasks/${task.id}`, { method: "DELETE" });
      setTasks((prev) => prev.filter((x) => x.id !== task.id));
      setNotice(`✓ 已删除 ${task.title}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[12px] text-tx3">
        ⠋ 读取 ~/cal…
      </div>
    );
  }

  return (
    <div className="mx-auto w-[min(1180px,97%)] py-8 font-mono">
      {/* 标题栏 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs text-tx3">~/cal · 日程管理</span>
          <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-tx3">
            {pendingCount} pending
          </span>
          {overlapping > 0 && (
            <span className="rounded border border-warn/50 px-1.5 py-0.5 text-[10px] text-warn">
              {overlapping} 项时间重叠
            </span>
          )}
          {!canWrite && (
            <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-warn">
              read-only
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-tx3">
          {canWrite && (
            <button
              className="rounded border border-acc/60 px-2 py-0.5 text-acc hover:bg-acc/10"
              onClick={() => openCreate()}
              title="新建日程"
            >
              ＋ 新建日程
            </button>
          )}
          <button
            className="rounded border border-line px-1.5 py-0.5 hover:border-acc hover:text-acc"
            onClick={() => shiftWeek(-1)}
            title="上一周"
          >
            ‹
          </button>
          <span className="min-w-[168px] text-center text-tx2">
            {weekStart.getFullYear()} · W{isoWeek(weekStart)} · {fmtMD(weekStart.getTime())} –{" "}
            {fmtMD(addDays(weekStart, 6).getTime())}
          </span>
          <button
            className="rounded border border-line px-1.5 py-0.5 hover:border-acc hover:text-acc"
            onClick={() => shiftWeek(1)}
            title="下一周"
          >
            ›
          </button>
          <button
            className="rounded border border-line px-2 py-0.5 text-[10px] hover:border-acc hover:text-acc"
            onClick={() => setWeekStart(startOfWeek(new Date()))}
          >
            今天
          </button>
        </div>
      </div>

      {/* 可视化新建 / 编辑表单 */}
      {draft && (
        <form
          className="mb-4 rounded-md border border-acc/40 bg-bg1 px-3 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void saveDraft();
          }}
        >
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-acc">▸ {draft.id ? "task.edit" : "task.new"}</span>
            <button
              type="button"
              className="text-tx3 hover:text-err"
              onClick={() => {
                setDraft(null);
                setCmdError(null);
              }}
            >
              × 取消
            </button>
          </div>
          <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-2 lg:grid-cols-6">
            <label className="flex flex-col gap-1 text-[10px] text-tx3 lg:col-span-2">
              标题
              <input
                className="rounded border border-line bg-bg px-2 py-1 text-[11px] text-tx outline-none placeholder:text-tx3 focus:border-acc"
                placeholder="例如：产品原型评审"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                autoFocus
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-tx3">
              日期
              <input
                type="date"
                className="rounded border border-line bg-bg px-2 py-1 text-[11px] text-tx outline-none focus:border-acc"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-tx3">
              开始时间
              <input
                type="time"
                className="rounded border border-line bg-bg px-2 py-1 text-[11px] text-tx outline-none focus:border-acc"
                value={draft.time}
                onChange={(e) => setDraft({ ...draft, time: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-tx3">
              时长（分）
              <input
                type="number"
                min={5}
                max={1440}
                step={5}
                className="rounded border border-line bg-bg px-2 py-1 text-[11px] text-tx outline-none focus:border-acc"
                value={draft.durationMin}
                onChange={(e) => setDraft({ ...draft, durationMin: Number(e.target.value) })}
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-tx3">
              优先级
              <select
                className="rounded border border-line bg-bg px-2 py-1 text-[11px] text-tx outline-none focus:border-acc"
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: e.target.value as TaskPriority })}
              >
                <option value="low">低</option>
                <option value="normal">普通</option>
                <option value="high">高</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-tx3 sm:col-span-2">
              地点
              <input
                className="rounded border border-line bg-bg px-2 py-1 text-[11px] text-tx outline-none placeholder:text-tx3 focus:border-acc"
                placeholder="会议室 B / 线上链接"
                value={draft.location}
                onChange={(e) => setDraft({ ...draft, location: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-tx3 sm:col-span-2 lg:col-span-4">
              备注
              <input
                className="rounded border border-line bg-bg px-2 py-1 text-[11px] text-tx outline-none placeholder:text-tx3 focus:border-acc"
                placeholder="可选：准备材料、参会人…"
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </label>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              className="rounded border border-acc/60 px-2.5 py-1 text-[11px] text-acc hover:bg-acc/10 disabled:opacity-40"
              type="submit"
              disabled={busy || !draft.title.trim()}
            >
              {busy ? "⠋ 保存中" : `⏎ ${draft.id ? "保存修改" : "创建日程"}`}
            </button>
            <span className="text-[10px] text-tx3">
              // 提醒默认在开始前 10 分钟
            </span>
            {cmdError && <span className="text-[11px] text-err">✗ {cmdError}</span>}
          </div>
        </form>
      )}

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
              placeholder="task.new 10:00 产品原型评审 [90] #high @会议室B   /   task.new 明天 09:30 写周报"
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
            // 一行命令排任务 · 时间支持 10:00 / 今天 10:00 / 明天 09:30 / 2026-11-03 14:00
          </div>
          {cmdError && <div className="mt-1 text-[11px] text-err">✗ {cmdError}</div>}
        </form>
      ) : (
        <div className="mb-4 rounded-md border border-dashed border-line px-3 py-2 text-[11px] text-tx3">
          // read-only · owner 可排任务、完成与删除
        </div>
      )}

      {notice && <div className="mb-3 text-[11px] text-acc">{notice}</div>}
      {error && (
        <div className="mb-3 rounded border border-err/50 bg-bg1 px-3 py-2 text-[12px] text-err">
          ✗ {error}
        </div>
      )}

      {/* 提醒条 */}
      {reminders.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-warn/40 bg-bg1 px-3 py-2 text-[11px]">
          <span className="text-warn">⏰ 提醒</span>
          {reminders.map((t) => (
            <span
              key={t.id}
              className={`rounded border px-2 py-0.5 ${
                t.startsAt < now ? "border-err/50 text-err" : "border-line text-tx2"
              }`}
            >
              {fmtMD(t.startsAt)} {fmtHM(t.startsAt)} · {t.title}
              {t.startsAt < now ? " · 已过期" : ""}
            </span>
          ))}
          <span className="ml-auto text-tx3">
            remindAt 到点提示 · 推送留待站内信模块
          </span>
        </div>
      )}

      {/* 周视图时间线 */}
      <div className="overflow-hidden rounded-lg border border-line bg-bg1">
        <div className="flex border-b border-line">
          <div className="w-[52px] flex-none py-2 text-center text-[10px] text-tx3">UTC+8</div>
          {weekDays.map((d) => {
            const isToday = dateKey(d) === todayKey;
            return (
              <div
                key={dateKey(d)}
                className={`flex-1 border-l border-line py-1.5 text-center ${
                  isToday ? "bg-bg2" : ""
                }`}
              >
                <div className={`text-[10px] ${isToday ? "text-acc" : "text-tx3"}`}>
                  {["一", "二", "三", "四", "五", "六", "日"][(d.getDay() + 6) % 7]}
                </div>
                <div className={`text-[12px] ${isToday ? "text-acc" : "text-tx2"}`}>
                  {pad(d.getMonth() + 1)}-{pad(d.getDate())}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex">
          {/* 时间轴 */}
          <div className="relative w-[52px] flex-none" style={{ height: (END_HOUR - START_HOUR) * HOUR_PX }}>
            {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
              <div
                key={i}
                className="absolute right-2 -translate-y-1/2 text-[10px] text-tx3"
                style={{ top: i * HOUR_PX }}
              >
                {pad(START_HOUR + i)}:00
              </div>
            ))}
          </div>

          {/* 每天一列 */}
          {weekDays.map((d) => {
            const dayStart = d.getTime();
            const placed = layoutDay(byDay.get(dateKey(d)) ?? [], dayStart);
            const isToday = dateKey(d) === todayKey;
            const nowTop = ((now - dayStart) / 60000 - START_HOUR * 60) / 60 * HOUR_PX;
            return (
              <div
                key={dateKey(d)}
                className={`relative min-w-0 flex-1 border-l border-line ${
                  isToday ? "bg-bg2/40" : ""
                } ${canWrite ? "cursor-crosshair" : ""}`}
                style={{ height: (END_HOUR - START_HOUR) * HOUR_PX }}
                title={canWrite ? "点击空白时间格新建日程" : undefined}
                onClick={(e) => {
                  if (!canWrite) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const rawMin = Math.round(((e.clientY - rect.top) / HOUR_PX * 60) / 30) * 30;
                  const total = START_HOUR * 60 + Math.min(Math.max(0, rawMin), MAX_MIN - 30);
                  openCreate(d, Math.floor(total / 60), total % 60);
                }}
              >
                {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
                  <div
                    key={i}
                    className="absolute inset-x-0 border-t border-line/60"
                    style={{ top: i * HOUR_PX }}
                  />
                ))}
                {isToday && nowTop >= 0 && nowTop <= (END_HOUR - START_HOUR) * HOUR_PX && (
                  <div
                    className="absolute inset-x-0 z-10 border-t border-acc"
                    style={{ top: nowTop }}
                    title={`现在 ${fmtHM(now)}`}
                  >
                    <span className="absolute -left-0.5 -top-[3px] h-[5px] w-[5px] rounded-full bg-acc" />
                  </div>
                )}
                {placed.map((p) => {
                  const t = p.task;
                  const muted = t.status !== "pending";
                  const cls = muted
                    ? "border-line bg-bg1 text-tx3"
                    : t.priority === "high"
                      ? "border-acc/60 bg-acc/10 text-tx"
                      : t.priority === "low"
                        ? "border-line bg-bg2 text-tx2"
                        : "border-line bg-bg2 text-tx";
                  const widthPct = 100 / p.lanes;
                  return (
                    <button
                      key={t.id}
                      className={`absolute overflow-hidden rounded border px-1 text-left transition-colors hover:z-20 ${cls} ${
                        selectedId === t.id ? "ring-1 ring-acc" : ""
                      }`}
                      style={{
                        top: p.top + 1,
                        height: p.height - 2,
                        left: `calc(${p.lane * widthPct}% + 3px)`,
                        width: `calc(${widthPct}% - 5px)`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId(t.id);
                      }}
                      title={`${fmtHM(t.startsAt)} – ${fmtHM(t.endsAt)} · ${t.title}`}
                    >
                      <div className={`truncate text-[10px] ${muted ? "line-through" : ""}`}>
                        {t.title}
                      </div>
                      {p.height >= 34 && (
                        <div className="truncate text-[9px] text-tx3">
                          {fmtHM(t.startsAt)}–{fmtHM(t.endsAt)}
                          {t.location ? ` · ${t.location}` : ""}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* 选中任务详情 + 快捷操作 */}
      {selected && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-acc/40 bg-bg1 px-3 py-2 text-[11px]">
          <span className="text-acc">▸ {selected.title}</span>
          <span className="text-tx3">
            {fmtMD(selected.startsAt)} {fmtHM(selected.startsAt)}–{fmtHM(selected.endsAt)} ·{" "}
            {selected.durationMin}m
          </span>
          <span className={`rounded border px-1 text-[9.5px] ${PRIORITY_CLASS[selected.priority]}`}>
            {PRIORITY_LABEL[selected.priority]}
          </span>
          {selected.location && <span className="text-tx3">@{selected.location}</span>}
          {selected.notes && <span className="truncate text-tx3">{selected.notes}</span>}
          <span className="text-tx3">
            {selected.status === "done"
              ? "done"
              : selected.status === "canceled"
                ? "canceled"
                : "pending"}
          </span>
          {canWrite && (
            <div className="ml-auto flex items-center gap-1.5 text-[10px]">
              <button
                className="rounded border border-line px-1.5 py-0.5 text-tx2 hover:border-acc hover:text-acc"
                onClick={() => openEdit(selected)}
              >
                ✎ 编辑
              </button>
              {selected.status === "pending" ? (
                <button
                  className="rounded border border-line px-1.5 py-0.5 text-tx2 hover:border-acc hover:text-acc"
                  onClick={() => void setStatus(selected, "done")}
                >
                  ✓ 完成
                </button>
              ) : (
                <button
                  className="rounded border border-line px-1.5 py-0.5 text-tx2 hover:border-acc hover:text-acc"
                  onClick={() => void setStatus(selected, "pending")}
                >
                  ↺ 恢复
                </button>
              )}
              {selected.status === "pending" && (
                <button
                  className="rounded border border-line px-1.5 py-0.5 text-tx3 hover:border-warn hover:text-warn"
                  onClick={() => void setStatus(selected, "canceled")}
                >
                  ⊘ 取消
                </button>
              )}
              <button
                className="rounded border border-err/50 px-1.5 py-0.5 text-err hover:bg-err/10"
                onClick={() => void removeTask(selected)}
              >
                ✗ 删除
              </button>
            </div>
          )}
        </div>
      )}

      {/* 任务清单 */}
      <div className="mt-4 overflow-hidden rounded-lg border border-line bg-bg1">
        <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[11px] text-tx3">
          <span>~/cal/tasks</span>
          <span>
            {tasks.length} tasks · {pendingCount} pending ·{" "}
            {tasks.filter((t) => t.status === "done").length} done
          </span>
        </div>
        {listTasks.length === 0 ? (
          <div className="px-4 py-12 text-center text-[12px] text-tx3">
            {canWrite
              ? "// 还没有任务 —— 点右上角「＋ 新建日程」，或直接点击时间格空白处"
              : "// 当前没有可查看的日程"}
          </div>
        ) : (
          <div className="max-h-[320px] overflow-y-auto">
            {listTasks.map((t) => {
              const on = selectedId === t.id;
              return (
                <div
                  key={t.id}
                  className={`group flex cursor-pointer items-center gap-2 border-b border-line px-3 py-2 text-[12px] ${
                    on ? "bg-bg2" : "hover:bg-bg2"
                  }`}
                  onClick={() => setSelectedId(t.id)}
                >
                  <span className="flex-none text-[10px] text-tx3">
                    {fmtMD(t.startsAt)} {fmtHM(t.startsAt)}
                  </span>
                  <span className="w-[42px] flex-none text-[10px] text-tx3">
                    {t.durationMin}m
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate ${
                      t.status === "done"
                        ? "text-tx3 line-through"
                        : t.status === "canceled"
                          ? "text-tx3 line-through"
                          : on
                            ? "text-acc"
                            : "text-tx"
                    }`}
                  >
                    {t.title}
                    {t.location && <span className="ml-1 text-[10px] text-tx3">@{t.location}</span>}
                  </span>
                  <span
                    className={`flex-none rounded border px-1 text-[9.5px] ${PRIORITY_CLASS[t.priority]}`}
                  >
                    {PRIORITY_LABEL[t.priority]}
                  </span>
                  <span className="w-[52px] flex-none text-right text-[10px] text-tx3">
                    {t.status === "done" ? "done" : t.status === "canceled" ? "canceled" : "pending"}
                  </span>
                  {canWrite && (
                    <>
                      {t.status === "pending" ? (
                        <button
                          className="flex-none rounded border border-line px-1.5 py-0.5 text-[10px] text-tx2 hover:border-acc hover:text-acc"
                          onClick={(e) => {
                            e.stopPropagation();
                            void setStatus(t, "done");
                          }}
                          title="标记完成"
                        >
                          ✓
                        </button>
                      ) : (
                        <button
                          className="flex-none rounded border border-line px-1.5 py-0.5 text-[10px] text-tx2 hover:border-acc hover:text-acc"
                          onClick={(e) => {
                            e.stopPropagation();
                            void setStatus(t, "pending");
                          }}
                          title="恢复为待办"
                        >
                          ↺
                        </button>
                      )}
                      <button
                        className="flex-none rounded border border-line px-1.5 py-0.5 text-[10px] text-tx3 hover:border-acc hover:text-acc"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(t);
                        }}
                        title="编辑"
                      >
                        ✎
                      </button>
                      <button
                        className="flex-none rounded border border-line px-1.5 py-0.5 text-[10px] text-tx3 hover:border-err hover:text-err"
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeTask(t);
                        }}
                        title="删除"
                      >
                        ✗
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-3 text-[10px] text-tx3">
        // 提醒：缺省开始前 10 分钟 · 周视图 08:00–21:00 · 推送与邮件另属独立模块
      </div>
    </div>
  );
}
