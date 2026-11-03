import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CrmCustomerDto,
  CrmDigestDto,
  CrmFollowUpDto,
  CrmFollowUpKind,
  CrmSeedResult,
  CrmStage,
} from "@aiwb/shared";
import { api } from "../../lib/api";
import { useAuthStore } from "../../stores/auth";

/** 与服务端 CRM_STALE_DAYS 保持一致；此处内联避免 Vite 解析 shared CJS 的运行时导出 */
const STALE_DAYS = 14;

const STAGES: { id: CrmStage; label: string }[] = [
  { id: "lead", label: "线索" },
  { id: "contacted", label: "跟进中" },
  { id: "proposal", label: "已报价" },
  { id: "negotiation", label: "洽谈" },
  { id: "won", label: "已成交" },
  { id: "lost", label: "流失" },
];

const STAGE_LABEL: Record<CrmStage, string> = {
  lead: "线索",
  contacted: "跟进中",
  proposal: "已报价",
  negotiation: "洽谈",
  won: "已成交",
  lost: "流失",
};

const STAGE_CLS: Record<CrmStage, string> = {
  lead: "border-line text-tx3",
  contacted: "border-line text-tx2",
  proposal: "border-acc/60 text-acc",
  negotiation: "border-acc/60 text-acc",
  won: "border-acc/60 text-acc",
  lost: "border-err/50 text-err/70",
};

const KIND_LABEL: Record<CrmFollowUpKind, string> = {
  lead: "线索",
  call: "通话",
  meeting: "会议",
  email: "邮件",
  quote: "报价",
  note: "备注",
};

const KIND_CLS: Record<CrmFollowUpKind, string> = {
  lead: "border-line text-tx3",
  call: "border-line text-tx2",
  meeting: "border-acc/50 text-acc",
  email: "border-line text-tx2",
  quote: "border-acc/60 text-acc",
  note: "border-line text-tx3",
};

const pad = (n: number) => String(n).padStart(2, "0");

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  return `${fmtDate(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtMoney(n: number): string {
  return n < 0 ? `-¥${(-n).toLocaleString("zh-CN")}` : `¥${n.toLocaleString("zh-CN")}`;
}

function parseAmount(src: string): number {
  return Number(src.replace(/[¥￥,\s]/g, ""));
}

function pipes(rest: string): string[] {
  return rest.split("|").map((s) => s.trim());
}

/** 客户列表行状态：成交 / 流失优先，其余按跟进新鲜度标黄 */
function badgeOf(c: CrmCustomerDto): { label: string; cls: string } {
  if (c.stage === "lost") return { label: "流失", cls: "border-err/50 text-err/70" };
  if (c.stage === "won") return { label: "已成交", cls: "border-acc/60 text-acc" };
  if (c.stale) return { label: "待跟进", cls: "border-warn/50 text-warn" };
  if (c.stage === "proposal" || c.stage === "negotiation") {
    return { label: "成交在望", cls: "border-acc/60 text-acc" };
  }
  return { label: "跟进中", cls: "border-line text-tx2" };
}

/** 按 id / 姓名 / 公司定位客户（命令栏与按钮共用） */
function findCustomer(list: CrmCustomerDto[], key: string): CrmCustomerDto | undefined {
  const q = key.trim();
  return (
    list.find((c) => c.id === q) ??
    list.find((c) => c.name.includes(q)) ??
    list.find((c) => c.company.includes(q))
  );
}

/** 客户管理：客户档案 + 跟进时间线 —— 终端式 CRM */
export default function CrmPanel() {
  const role = useAuthStore((s) => s.user?.role ?? "guest");
  // 原型 ACL：~/crm owner rw / member × / guest ×
  const canAccess = role === "owner";
  const canWrite = canAccess;

  const [digest, setDigest] = useState<CrmDigestDto | null>(null);
  const [customers, setCustomers] = useState<CrmCustomerDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CrmCustomerDto | null>(null);
  const [followUps, setFollowUps] = useState<CrmFollowUpDto[]>([]);

  const [stageFilter, setStageFilter] = useState<CrmStage | "all">("all");
  const [staleOnly, setStaleOnly] = useState(false);
  const [query, setQuery] = useState("");

  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cmd, setCmd] = useState("");
  const [cmdError, setCmdError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const [c, f] = await Promise.all([
        api<CrmCustomerDto>(`/crm/customers/${id}`),
        api<CrmFollowUpDto[]>(`/crm/customers/${id}/followups`),
      ]);
      setDetail(c);
      setFollowUps(f);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const loadAll = useCallback(
    async (preferredId?: string | null) => {
      if (!canAccess) {
        setLoading(false);
        return;
      }
      try {
        const [d, list] = await Promise.all([
          api<CrmDigestDto>("/crm/digest"),
          api<CrmCustomerDto[]>("/crm/customers"),
        ]);
        setDigest(d);
        setCustomers(list);
        setError(null);

        const target =
          preferredId && list.some((c) => c.id === preferredId) ? preferredId : list[0]?.id ?? null;
        setSelectedId(target);
        if (target) await loadDetail(target);
        else {
          setDetail(null);
          setFollowUps([]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [canAccess, loadDetail],
  );

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const selectCustomer = (id: string) => {
    setSelectedId(id);
    void loadDetail(id);
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((c) => {
      if (stageFilter !== "all" && c.stage !== stageFilter) return false;
      if (staleOnly && !c.stale) return false;
      if (!q) return true;
      return `${c.name}\n${c.company}\n${c.contact}\n${c.source}\n${c.notes}\n${c.lastFollowUp ?? ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [customers, stageFilter, staleOnly, query]);

  const execute = useCallback(
    async (work: () => Promise<string>, fail: (msg: string) => void) => {
      setBusy(true);
      setNotice(null);
      setError(null);
      try {
        const msg = await work();
        setNotice(msg);
        await loadAll(selectedId);
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [loadAll, selectedId],
  );

  const setStage = (c: CrmCustomerDto, stage: CrmStage) =>
    execute(async () => {
      const next = await api<CrmCustomerDto>(`/crm/customers/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({ stage }),
      });
      return `✓ ${next.name} → ${STAGE_LABEL[next.stage]}`;
    }, setError);

  const removeFollowUp = async (f: CrmFollowUpDto) => {
    if (!detail) return;
    setError(null);
    try {
      await api(`/crm/customers/${detail.id}/followups/${f.id}`, { method: "DELETE" });
      setNotice("✓ 已删除一条跟进记录");
      await loadAll(detail.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const runSeed = async () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const r = await api<CrmSeedResult>("/crm/seed", { method: "POST" });
      setNotice(
        r.seeded
          ? `✓ 已生成演示数据：${r.customers} 位客户 · ${r.followUps} 条跟进`
          : "// 已有客户数据，未重复写入",
      );
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
    setBusy(true);
    try {
      if (/^crm\.seed$/i.test(src)) {
        const r = await api<CrmSeedResult>("/crm/seed", { method: "POST" });
        setCmd("");
        setNotice(
          r.seeded
            ? `✓ 已生成演示数据：${r.customers} 位客户 · ${r.followUps} 条跟进`
            : "// 已有客户数据，未重复写入",
        );
        await loadAll();
      } else if (/^crm\.new\b/i.test(src)) {
        const parts = pipes(src.replace(/^crm\.new\s*/i, ""));
        const [name, company, stage, valueStr] = parts;
        if (!name) {
          setCmdError("用法：crm.new <姓名> | <公司> | <阶段> | <预计金额>");
          return;
        }
        const value = valueStr ? parseAmount(valueStr) : 0;
        if (!Number.isFinite(value) || value < 0) {
          setCmdError("预计金额需为非负数字");
          return;
        }
        const created = await api<CrmCustomerDto>("/crm/customers", {
          method: "POST",
          body: JSON.stringify({
            name,
            company: company || undefined,
            stage: stage || undefined,
            value,
          }),
        });
        setCmd("");
        setNotice(`✓ 已建档 ${created.name}${created.company ? ` · ${created.company}` : ""}`);
        await loadAll(created.id);
      } else if (/^crm\.log\b/i.test(src)) {
        const [key, second, ...rest] = pipes(src.replace(/^crm\.log\s*/i, ""));
        if (!key || !second) {
          setCmdError("用法：crm.log <客户> | <类型> | <内容>");
          return;
        }
        const target = findCustomer(customers, key);
        if (!target) {
          setCmdError(`未找到客户「${key}」`);
          return;
        }
        const kind = (rest.length > 0 ? second : "note") as CrmFollowUpKind;
        const content = rest.length > 0 ? rest.join(" | ") : second;
        await api<CrmFollowUpDto>(`/crm/customers/${target.id}/followups`, {
          method: "POST",
          body: JSON.stringify({ kind, content }),
        });
        setCmd("");
        setNotice(`✓ 已记录 ${target.name} 的跟进 · ${KIND_LABEL[kind] ?? kind}`);
        await loadAll(target.id);
      } else if (/^crm\.stage\b/i.test(src)) {
        const [key, stage] = pipes(src.replace(/^crm\.stage\s*/i, ""));
        if (!key || !stage) {
          setCmdError("用法：crm.stage <客户> | <阶段>");
          return;
        }
        const target = findCustomer(customers, key);
        if (!target) {
          setCmdError(`未找到客户「${key}」`);
          return;
        }
        const next = await api<CrmCustomerDto>(`/crm/customers/${target.id}`, {
          method: "PATCH",
          body: JSON.stringify({ stage }),
        });
        setCmd("");
        setNotice(`✓ ${next.name} → ${STAGE_LABEL[next.stage]}`);
        await loadAll(target.id);
      } else {
        setCmdError("可用命令：crm.seed · crm.new · crm.log · crm.stage");
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
        <div className="text-err">403 · ~/crm 仅 owner 可访问</div>
        <div>// 原型 ACL：owner rw · member × · guest ×</div>
        <div>// 客户资料含联系方式与商业报价，不向协作者与游客开放</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[12px] text-tx3">
        ⠋ 读取 ~/crm/customers…
      </div>
    );
  }

  const staleCount = customers.filter((c) => c.stale).length;
  const wonCount = customers.filter((c) => c.stage === "won").length;

  const kpis = [
    {
      k: "客户总数",
      v: `${digest?.total ?? 0}`,
      d: `${digest?.active ?? 0} 位进行中 · 本月新增 ${digest?.monthNew ?? 0}`,
    },
    {
      k: "待跟进",
      v: `${digest?.stale ?? 0}`,
      d: `超过 ${STALE_DAYS} 天未联系 · 近 7 天 ${digest?.weekFollowUps ?? 0} 条跟进`,
    },
    {
      k: "管道金额",
      v: fmtMoney(digest?.pipelineValue ?? 0),
      d: "进行中客户的预计成交额",
    },
    {
      k: "已成交",
      v: `${digest?.won ?? 0} 位`,
      d: `合同金额 ${fmtMoney(digest?.wonValue ?? 0)} · 流失 ${digest?.lost ?? 0}`,
    },
  ];

  const stageChips: { id: CrmStage | "all"; label: string }[] = [
    { id: "all", label: "all" },
    ...STAGES.map((s) => ({ id: s.id, label: s.label })),
  ];

  return (
    <div className="mx-auto w-[min(1280px,97%)] py-6 font-mono">
      {/* 标题栏 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs text-tx3">~/crm/customers — {digest?.total ?? 0} total</span>
          <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-tx3">
            {digest?.active ?? 0} active
          </span>
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] ${
              staleCount > 0 ? "border-warn/50 text-warn" : "border-line text-tx3"
            }`}
          >
            {staleCount} stale
          </span>
          <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-tx3">
            {wonCount} won
          </span>
        </div>
        {canWrite && (
          <div className="flex items-center gap-2 text-[11px]">
            <button
              className="rounded border border-line px-2 py-0.5 text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
              onClick={() => setCmd("crm.new ")}
              disabled={busy}
            >
              新建客户
            </button>
            <button
              className="rounded border border-line px-2 py-0.5 text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
              onClick={() => void runSeed()}
              disabled={busy}
            >
              演示数据
            </button>
            <button
              className="rounded border border-line px-2 py-0.5 text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
              onClick={() => void loadAll(selectedId)}
              disabled={busy}
            >
              刷新
            </button>
          </div>
        )}
      </div>

      {/* 摘要 */}
      {digest && (
        <div className="mb-3 rounded-md border border-line bg-bg1 px-3 py-2 text-[11px] text-tx3">
          {digest.summary.split("·").map((part, i) =>
            i === 0 ? (
              <b key={i} className="font-medium text-acc">{part.trim()}</b>
            ) : (
              <span key={i}>· {part.trim()}</span>
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

      {/* 过滤 */}
      <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-line pb-2 text-[11px]">
        {stageChips.map((f) => (
          <button
            key={f.id}
            className={`rounded border px-1.5 py-0.5 ${
              stageFilter === f.id ? "border-acc text-acc" : "border-line text-tx3 hover:border-acc"
            }`}
            onClick={() => setStageFilter(f.id)}
          >
            {f.label}
            <span className="ml-1 text-[10px] text-tx3">
              {f.id === "all" ? customers.length : customers.filter((c) => c.stage === f.id).length}
            </span>
          </button>
        ))}
        <button
          className={`rounded border px-1.5 py-0.5 ${
            staleOnly ? "border-warn text-warn" : "border-line text-tx3 hover:border-warn"
          }`}
          onClick={() => setStaleOnly((v) => !v)}
        >
          ⚑ &gt;{STALE_DAYS}d
          <span className="ml-1 text-[10px] text-tx3">{staleCount}</span>
        </button>
        <input
          className="ml-auto w-[200px] rounded border border-line bg-bg1 px-2 py-0.5 text-[11px] text-tx outline-none placeholder:text-tx3 focus:border-acc"
          placeholder="grep 姓名 / 公司 / 备注…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {notice && <div className="mb-2 text-[11px] text-acc">{notice}</div>}
      {error && (
        <div className="mb-2 rounded border border-err/50 bg-bg1 px-3 py-2 text-[12px] text-err">
          ✗ {error}
        </div>
      )}

      {/* 命令栏 */}
      {canWrite && (
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
              placeholder="crm.log 陈静 | quote | 发送报价单 v3   /   crm.new 张三 | 某公司 | lead | 5000   /   crm.stage 陈静 | won"
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
            // crm.new 姓名 | 公司 | 阶段 | 金额 · crm.log 客户 | 类型 | 内容 · crm.stage 客户 | 阶段
          </div>
          {cmdError && <div className="mt-1 text-[11px] text-err">✗ {cmdError}</div>}
        </form>
      )}

      {/* 列表 + 时间线 */}
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <div className="overflow-hidden rounded-lg border border-line bg-bg1">
          <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[10.5px] text-tx3">
            <span>~/crm/customers</span>
            <span>{visible.length} shown · {customers.length} total</span>
          </div>
          <div className="max-h-[520px] overflow-y-auto">
            {visible.length === 0 ? (
              <div className="px-4 py-12 text-center text-[12px] text-tx3">
                {customers.length === 0
                  ? "// 还没有客户 —— 输入 crm.seed 生成演示数据"
                  : "// 当前过滤条件没有匹配的客户"}
              </div>
            ) : (
              visible.map((c) => {
                const badge = badgeOf(c);
                return (
                  <button
                    key={c.id}
                    className={`block w-full border-b border-line px-3 py-2.5 text-left last:border-b-0 hover:bg-bg2 ${
                      c.id === selectedId ? "bg-bg2" : ""
                    } ${c.stale ? "border-l-2 border-l-warn" : "border-l-2 border-l-transparent"}`}
                    onClick={() => selectCustomer(c.id)}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[12px] text-tx">
                        <b className="font-medium">{c.name}</b>
                        {c.company && <span className="text-tx3"> · {c.company}</span>}
                      </span>
                      <span className={`flex-none rounded border px-1.5 py-[1px] text-[9.5px] ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-[10.5px] text-tx3">
                      {c.notes || c.lastFollowUp || "// 暂无备注"}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-tx3">
                      <span>{c.followUpCount} 条跟进 · {fmtMoney(c.value)}</span>
                      <span className={c.stale ? "text-warn" : ""}>
                        {c.daysSinceContact === 0 ? "今天" : `${c.daysSinceContact}d 前`}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="flex min-h-[420px] flex-col overflow-hidden rounded-lg border border-line bg-bg1">
          {!detail ? (
            <div className="flex flex-1 items-center justify-center px-4 py-16 text-center text-[11px] text-tx3">
              // 选择左侧客户查看跟进时间线
            </div>
          ) : (
            <>
              <div className="border-b border-line px-3 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13px] text-tx">
                    <span className="text-acc">▸</span> {detail.name}
                    {detail.company && <span className="text-tx3"> · {detail.company}</span>}
                  </span>
                  <span
                    className={`rounded border px-1.5 py-[1px] text-[9.5px] ${STAGE_CLS[detail.stage]}`}
                  >
                    {STAGE_LABEL[detail.stage]}
                  </span>
                </div>
                <div className="mt-1 text-[10.5px] text-tx3">
                  估值 {fmtMoney(detail.value)} · score {detail.score}/100
                  {detail.source ? ` · 来源 ${detail.source}` : ""}
                  {detail.projectName ? ` · ${detail.projectName}` : ""}
                </div>
                {detail.contact && <div className="mt-0.5 text-[10.5px] text-tx3">{detail.contact}</div>}
                {detail.notes && <div className="mt-1 text-[11px] text-tx2">{detail.notes}</div>}
              </div>

              {canWrite && (
                <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2 text-[10px]">
                  <span className="text-tx3">stage:</span>
                  {STAGES.map((s) => (
                    <button
                      key={s.id}
                      className={`rounded border px-1.5 py-[1px] ${
                        detail.stage === s.id
                          ? "border-acc text-acc"
                          : "border-line text-tx3 hover:border-acc hover:text-acc"
                      }`}
                      onClick={() => void setStage(detail, s.id)}
                      disabled={busy || detail.stage === s.id}
                    >
                      {s.label}
                    </button>
                  ))}
                  <span className="ml-auto text-tx3">
                    最近 {fmtDate(detail.lastContactAt)}
                    {detail.stale && <span className="ml-1 text-warn">⚑</span>}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[10.5px] text-tx3">
                <span>~/.crm/{detail.name}/timeline.log</span>
                <span>{followUps.length} events</span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                {detailLoading ? (
                  <div className="py-8 text-center text-[11px] text-tx3">⠋ 读取时间线…</div>
                ) : followUps.length === 0 ? (
                  <div className="py-8 text-center text-[11px] text-tx3">
                    // 还没有跟进记录 —— 用 crm.log {detail.name} | note | 内容 记一条
                  </div>
                ) : (
                  followUps.map((f) => (
                    <div key={f.id} className="relative border-l border-line pb-3 pl-3 last:pb-0">
                      <span className="absolute -left-[3px] top-1.5 h-1.5 w-1.5 rounded-full bg-acc" />
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[10px] text-tx3">{fmtDateTime(f.happenedAt)}</span>
                        <span
                          className={`rounded border px-1.5 py-[1px] text-[9.5px] ${KIND_CLS[f.kind]}`}
                        >
                          {KIND_LABEL[f.kind]}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-tx2">{f.content}</div>
                      {canWrite && (
                        <button
                          className="mt-0.5 text-[9.5px] text-tx3 hover:text-err"
                          onClick={() => void removeFollowUp(f)}
                        >
                          × 删除
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="border-t border-line px-3 py-2 text-[10px] text-tx3">
                // crm.log {detail.name} | quote | 内容 · crm.stage {detail.name} | won
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
