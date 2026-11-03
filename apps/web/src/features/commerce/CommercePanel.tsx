import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CommerceAdDto,
  CommerceAdStatus,
  CommerceDigestDto,
  CommerceOrderDto,
  CommerceOrderStatus,
  CommercePlanDto,
  CommerceSeedResult,
} from "@aiwb/shared";
import { api } from "../../lib/api";
import { useAuthStore } from "../../stores/auth";

type Tab = "overview" | "orders" | "plans" | "ads";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "总览" },
  { id: "orders", label: "订单" },
  { id: "plans", label: "订阅方案" },
  { id: "ads", label: "广告位" },
];

const ORDER_META: Record<CommerceOrderStatus, { label: string; cls: string }> = {
  pending: { label: "待支付", cls: "border-warn/50 text-warn" },
  paid: { label: "已支付", cls: "border-acc/60 text-acc" },
  refunded: { label: "已退款", cls: "border-err/50 text-err/80" },
};

const PLAN_STATUS_META: Record<"active" | "archived", { label: string; cls: string }> = {
  active: { label: "运营中", cls: "border-acc/60 text-acc" },
  archived: { label: "停售", cls: "border-line text-tx3" },
};

const AD_STATUS_META: Record<CommerceAdStatus, { label: string; cls: string }> = {
  planned: { label: "计划", cls: "border-line text-tx3" },
  active: { label: "在线", cls: "border-acc/60 text-acc" },
  paused: { label: "暂停", cls: "border-warn/50 text-warn" },
  ended: { label: "结束", cls: "border-line text-tx3" },
};

const CHANNEL_LABEL: Record<string, string> = {
  alipay: "支付宝",
  wechat: "微信",
  manual: "手动",
  other: "其他",
};

const AD_CHANNEL_LABEL: Record<string, string> = {
  web: "网站",
  social: "社交",
  search: "搜索",
  other: "其他",
};

const CYCLE_LABEL: Record<string, string> = { monthly: "月", yearly: "年" };

const pad = (n: number) => String(n).padStart(2, "0");

function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

/** 按 id / 客户名 / 商品关键词定位订单（命令栏与按钮共用） */
function findOrder(list: CommerceOrderDto[], key: string): CommerceOrderDto | undefined {
  const q = key.trim();
  return (
    list.find((o) => o.id === q) ??
    list.find((o) => o.customerName.includes(q)) ??
    list.find((o) => `${o.item} ${o.planName ?? ""} ${o.projectName ?? ""}`.includes(q))
  );
}

/** 订单行尾注：方案名已在商品说明中出现时不重复展示 */
function orderSuffix(o: CommerceOrderDto): string {
  return [o.planName && !o.item.includes(o.planName) ? o.planName : null, o.projectName]
    .filter(Boolean)
    .join(" · ");
}

function findPlan(list: CommercePlanDto[], key: string): CommercePlanDto | undefined {
  const q = key.trim();
  return list.find((p) => p.id === q) ?? list.find((p) => p.name.includes(q));
}

function findAd(list: CommerceAdDto[], key: string): CommerceAdDto | undefined {
  const q = key.trim();
  return list.find((a) => a.id === q) ?? list.find((a) => a.name.includes(q));
}

/** 商业化：订阅方案 · 支付流水 · 广告位 —— 终端营收看板 */
export default function CommercePanel() {
  const role = useAuthStore((s) => s.user?.role ?? "guest");
  // 原型 ACL：~/biz owner rw / member × / guest ×
  const canAccess = role === "owner";
  const canWrite = canAccess;

  const [digest, setDigest] = useState<CommerceDigestDto | null>(null);
  const [plans, setPlans] = useState<CommercePlanDto[]>([]);
  const [orders, setOrders] = useState<CommerceOrderDto[]>([]);
  const [ads, setAds] = useState<CommerceAdDto[]>([]);

  const [tab, setTab] = useState<Tab>("overview");
  const [statusFilter, setStatusFilter] = useState<CommerceOrderStatus | "all">("all");
  const [query, setQuery] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cmd, setCmd] = useState("");
  const [cmdError, setCmdError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    try {
      const [d, p, o, a] = await Promise.all([
        api<CommerceDigestDto>("/commerce/digest"),
        api<CommercePlanDto[]>("/commerce/plans"),
        api<CommerceOrderDto[]>("/commerce/orders"),
        api<CommerceAdDto[]>("/commerce/ads"),
      ]);
      setDigest(d);
      setPlans(p);
      setOrders(o);
      setAds(a);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [canAccess]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const visibleOrders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (!q) return true;
      return `${o.customerName}\n${o.item}\n${o.planName ?? ""}\n${o.projectName ?? ""}\n${o.channel}`
        .toLowerCase()
        .includes(q);
    });
  }, [orders, statusFilter, query]);

  const execute = useCallback(
    async (work: () => Promise<string>, fail: (msg: string) => void) => {
      setBusy(true);
      setNotice(null);
      setError(null);
      try {
        const msg = await work();
        setNotice(msg);
        await reload();
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const payOrder = (o: CommerceOrderDto) =>
    execute(async () => {
      const next = await api<CommerceOrderDto>(`/commerce/orders/${o.id}/pay`, { method: "POST" });
      return `✓ ${next.customerName} · ${fmtMoney(next.amount)} 已支付`;
    }, setError);

  const refundOrder = (o: CommerceOrderDto) =>
    execute(async () => {
      const next = await api<CommerceOrderDto>(`/commerce/orders/${o.id}/refund`, { method: "POST" });
      return `✓ ${next.customerName} · ${fmtMoney(next.amount)} 已退款`;
    }, setError);

  const togglePlan = (p: CommercePlanDto) =>
    execute(async () => {
      const next = await api<CommercePlanDto>(`/commerce/plans/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: p.status === "active" ? "archived" : "active" }),
      });
      return next.status === "active" ? `✓ ${next.name} 已重新上架` : `✓ ${next.name} 已停售`;
    }, setError);

  const setAdStatus = (a: CommerceAdDto, status: CommerceAdStatus) =>
    execute(async () => {
      const next = await api<CommerceAdDto>(`/commerce/ads/${a.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      return `✓ ${next.name} → ${AD_STATUS_META[next.status].label}`;
    }, setError);

  const runSeed = async () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const r = await api<CommerceSeedResult>("/commerce/seed", { method: "POST" });
      setNotice(
        r.seeded
          ? `✓ 已生成演示数据：${r.plans} 个方案 · ${r.orders} 笔订单 · ${r.ads} 个广告位`
          : "// 已有商业化数据，未重复写入",
      );
      await reload();
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
      if (/^biz\.seed$/i.test(src)) {
        const r = await api<CommerceSeedResult>("/commerce/seed", { method: "POST" });
        setCmd("");
        setNotice(
          r.seeded
            ? `✓ 已生成演示数据：${r.plans} 个方案 · ${r.orders} 笔订单 · ${r.ads} 个广告位`
            : "// 已有商业化数据，未重复写入",
        );
        await reload();
      } else if (/^biz\.order\.new\b/i.test(src)) {
        const parts = pipes(src.replace(/^biz\.order\.new\s*/i, ""));
        const [customerName, amountStr, item, channel] = parts;
        if (!customerName || !amountStr) {
          setCmdError("用法：biz.order.new <客户> | <金额> | <说明> | <渠道>");
          return;
        }
        const amount = parseAmount(amountStr);
        if (!Number.isFinite(amount) || amount <= 0) {
          setCmdError("金额需为正数，如 biz.order.new 陈静 | 29 | pro 订阅 | alipay");
          return;
        }
        const created = await api<CommerceOrderDto>("/commerce/orders", {
          method: "POST",
          body: JSON.stringify({
            customerName,
            amount,
            item: item || undefined,
            channel: channel || undefined,
          }),
        });
        setCmd("");
        setNotice(`✓ 已记录订单：${created.customerName} · ${fmtMoney(created.amount)}（${ORDER_META[created.status].label}）`);
        await reload();
      } else if (/^biz\.plan\.new\b/i.test(src)) {
        const parts = pipes(src.replace(/^biz\.plan\.new\s*/i, ""));
        const [name, priceStr, cycle, subsStr] = parts;
        if (!name || !priceStr) {
          setCmdError("用法：biz.plan.new <名称> | <价格> | <monthly|yearly> | <订阅人数>");
          return;
        }
        const price = parseAmount(priceStr);
        if (!Number.isFinite(price) || price < 0) {
          setCmdError("价格需为非负数字");
          return;
        }
        const subscribers = subsStr ? parseAmount(subsStr) : 0;
        const created = await api<CommercePlanDto>("/commerce/plans", {
          method: "POST",
          body: JSON.stringify({
            name,
            price,
            cycle: cycle || "monthly",
            subscribers: Number.isFinite(subscribers) ? subscribers : 0,
          }),
        });
        setCmd("");
        setNotice(`✓ 已创建方案 ${created.name} · ${fmtMoney(created.price)}/${CYCLE_LABEL[created.cycle]}`);
        await reload();
      } else if (/^biz\.order\.(pay|refund)\b/i.test(src)) {
        const action = /pay/i.test(src) ? "pay" : "refund";
        const key = src.replace(/^biz\.order\.(pay|refund)\s*/i, "").trim();
        if (!key) {
          setCmdError(`用法：biz.order.${action} <订单 id 或客户关键词>`);
          return;
        }
        const target = findOrder(orders, key);
        if (!target) {
          setCmdError(`未找到订单「${key}」`);
          return;
        }
        const next = await api<CommerceOrderDto>(`/commerce/orders/${target.id}/${action}`, {
          method: "POST",
        });
        setCmd("");
        setNotice(`✓ ${next.customerName} 的订单已${action === "pay" ? "支付" : "退款"} · ${fmtMoney(next.amount)}`);
        await reload();
      } else if (/^biz\.plan\.(archive|activate)\b/i.test(src)) {
        const archive = /archive/i.test(src);
        const key = src.replace(/^biz\.plan\.(archive|activate)\s*/i, "").trim();
        const target = key ? findPlan(plans, key) : undefined;
        if (!target) {
          setCmdError(`用法：biz.plan.${archive ? "archive" : "activate"} <方案名>`);
          return;
        }
        const next = await api<CommercePlanDto>(`/commerce/plans/${target.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: archive ? "archived" : "active" }),
        });
        setCmd("");
        setNotice(`✓ ${next.name} 已${next.status === "active" ? "上架" : "停售"}`);
        await reload();
      } else if (/^biz\.ad\.new\b/i.test(src)) {
        const parts = pipes(src.replace(/^biz\.ad\.new\s*/i, ""));
        const [name, budgetStr, channel] = parts;
        if (!name || !budgetStr) {
          setCmdError("用法：biz.ad.new <名称> | <预算> | <web|social|search|other>");
          return;
        }
        const budget = parseAmount(budgetStr);
        if (!Number.isFinite(budget) || budget < 0) {
          setCmdError("预算需为非负数字");
          return;
        }
        const created = await api<CommerceAdDto>("/commerce/ads", {
          method: "POST",
          body: JSON.stringify({ name, budget, channel: channel || "web" }),
        });
        setCmd("");
        setNotice(`✓ 已创建广告位 ${created.name} · 预算 ${fmtMoney(created.budget)}`);
        await reload();
      } else if (/^biz\.ad\.(activate|pause|end)\b/i.test(src)) {
        const action = /activate/i.test(src) ? "active" : /pause/i.test(src) ? "paused" : "ended";
        const key = src.replace(/^biz\.ad\.(activate|pause|end)\s*/i, "").trim();
        const target = key ? findAd(ads, key) : undefined;
        if (!target) {
          setCmdError(`用法：biz.ad.${action === "active" ? "activate" : action === "paused" ? "pause" : "end"} <广告位名称>`);
          return;
        }
        const next = await api<CommerceAdDto>(`/commerce/ads/${target.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: action }),
        });
        setCmd("");
        setNotice(`✓ ${next.name} → ${AD_STATUS_META[next.status].label}`);
        await reload();
      } else {
        setCmdError(
          "可用命令：biz.seed · biz.order.new · biz.plan.new · biz.ad.new · biz.order.pay/refund · biz.plan.archive/activate · biz.ad.activate/pause/end",
        );
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
        <div className="text-err">403 · ~/biz 仅 owner 可访问</div>
        <div>// 原型 ACL：owner rw · member × · guest ×</div>
        <div>// 商业化数据包含支付与广告预算，不向协作者与游客开放</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[12px] text-tx3">
        ⠋ 读取 ~/biz/revenue.dashboard…
      </div>
    );
  }

  const kpis = [
    { k: "mrr", v: fmtMoney(digest?.mrr ?? 0), d: `${digest?.subscribers ?? 0} 位订阅 · ${digest?.activePlans ?? 0} 个在售方案` },
    {
      k: "支付成功",
      v: `${digest?.paid ?? 0} 单`,
      d: `本月 ${fmtMoney(digest?.monthRevenue ?? 0)} · 待支付 ${digest?.pending ?? 0}`,
    },
    { k: "广告消耗", v: fmtMoney(digest?.adSpend ?? 0), d: `预算 ${fmtMoney(digest?.adBudget ?? 0)}` },
    {
      k: "净收入",
      v: fmtMoney(digest?.net ?? 0),
      d: `累计支付 ${fmtMoney(digest?.revenue ?? 0)} · 退款 ${fmtMoney(digest?.refunded ?? 0)}`,
    },
  ];

  const orderFilterChips: { id: CommerceOrderStatus | "all"; label: string }[] = [
    { id: "all", label: "全部" },
    { id: "pending", label: "待支付" },
    { id: "paid", label: "已支付" },
    { id: "refunded", label: "已退款" },
  ];

  const recentOrders = orders.slice(0, 5);
  const overviewPlans = plans.slice(0, 3);
  const overviewAds = ads.slice(0, 3);
  const monthLabel = `${new Date().getFullYear()}-${pad(new Date().getMonth() + 1)}`;

  return (
    <div className="mx-auto w-[min(1280px,97%)] py-6 font-mono">
      {/* 标题栏 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs text-tx3">~/biz/revenue.dashboard — {monthLabel}</span>
          <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-tx3">
            {digest?.plans ?? 0} plans
          </span>
          <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-tx3">
            {digest?.orders ?? 0} orders
          </span>
          <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-tx3">
            {ads.length} ads
          </span>
        </div>
        {canWrite && (
          <div className="flex items-center gap-2 text-[11px]">
            <button
              className="rounded border border-line px-2 py-0.5 text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
              onClick={() => setCmd("biz.order.new ")}
              disabled={busy}
            >
              记一笔订单
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
              onClick={() => void reload()}
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

      {/* tabs */}
      <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-line pb-2 text-[11px]">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`rounded border px-2 py-0.5 ${
              tab === t.id ? "border-acc text-acc" : "border-line text-tx3 hover:border-acc"
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "orders" && <span className="ml-1 text-[10px] text-tx3">{orders.length}</span>}
            {t.id === "plans" && <span className="ml-1 text-[10px] text-tx3">{plans.length}</span>}
            {t.id === "ads" && <span className="ml-1 text-[10px] text-tx3">{ads.length}</span>}
          </button>
        ))}
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
              placeholder="biz.order.new 陈静 | 29 | pro 订阅 | alipay   /   biz.plan.new pro | 29 | monthly | 62   /   biz.seed"
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
            // biz.order.new 客户 | 金额 | 说明 | 渠道 · biz.plan.new 名称 | 价格 | 周期 | 人数 · biz.ad.new 名称 | 预算 | 渠道
          </div>
          {cmdError && <div className="mt-1 text-[11px] text-err">✗ {cmdError}</div>}
        </form>
      )}

      {/* 总览 */}
      {tab === "overview" && (
        <div>
          <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {kpis.map((s) => (
              <div key={s.k} className="rounded-lg border border-line bg-bg1 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider text-tx3">{s.k}</div>
                <div className="mt-1 text-[20px] text-tx">{s.v}</div>
                <div className="mt-0.5 text-[10px] text-tx3">{s.d}</div>
              </div>
            ))}
          </div>

          {plans.length === 0 && orders.length === 0 && ads.length === 0 ? (
            <div className="rounded-lg border border-line bg-bg1 px-4 py-14 text-center text-[12px] text-tx3">
              // 还没有商业化数据
              <br />
              // 输入 biz.seed 生成演示数据，或用 biz.plan.new / biz.order.new / biz.ad.new 建第一条记录
            </div>
          ) : (
            <>
              <div className="mb-1.5 flex items-center justify-between text-[10.5px] text-tx3">
                <span>订阅计划</span>
                <button className="hover:text-acc" onClick={() => setTab("plans")}>全部 →</button>
              </div>
              <div className="mb-4 overflow-hidden rounded-lg border border-line bg-bg1">
                {overviewPlans.length === 0 ? (
                  <div className="px-3 py-4 text-[11px] text-tx3">// 暂无订阅方案</div>
                ) : (
                  overviewPlans.map((p) => (
                    <div
                      key={p.id}
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_80px] items-baseline gap-2 border-b border-line px-3 py-2 text-[12px] last:border-b-0"
                    >
                      <span className="truncate text-tx">
                        <b className="font-medium">{p.name}</b> · {fmtMoney(p.price)}/{CYCLE_LABEL[p.cycle]}
                      </span>
                      <span className="truncate text-[11px] text-tx3">
                        {p.subscribers} 人 · MRR {fmtMoney(p.mrr)}
                        {p.projectName ? ` · ${p.projectName}` : ""}
                      </span>
                      <span className={`justify-self-start rounded border px-1.5 py-[1px] text-[9.5px] ${PLAN_STATUS_META[p.status].cls}`}>
                        {PLAN_STATUS_META[p.status].label}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="mb-1.5 flex items-center justify-between text-[10.5px] text-tx3">
                <span>最近支付流水</span>
                <button className="hover:text-acc" onClick={() => setTab("orders")}>全部 →</button>
              </div>
              <div className="mb-4 overflow-hidden rounded-lg border border-line bg-bg1">
                {recentOrders.length === 0 ? (
                  <div className="px-3 py-4 text-[11px] text-tx3">// 暂无支付流水</div>
                ) : (
                  recentOrders.map((o) => (
                    <div
                      key={o.id}
                      className="grid grid-cols-[78px_minmax(0,1fr)_86px_66px] items-baseline gap-2 border-b border-line px-3 py-2 text-[12px] last:border-b-0"
                    >
                      <span className="text-[10.5px] text-tx3">{fmtDate(o.createdAt)}</span>
                      <span className="truncate text-tx2">
                        {o.customerName} · {o.item}
                        <span className="ml-1 text-[10.5px] text-tx3">
                          {CHANNEL_LABEL[o.channel] ?? o.channel}
                        </span>
                      </span>
                      <span className={`justify-self-end ${o.status === "refunded" ? "text-tx3 line-through" : "text-acc"}`}>
                        {fmtMoney(o.amount)}
                      </span>
                      <span className={`justify-self-start rounded border px-1.5 py-[1px] text-[9.5px] ${ORDER_META[o.status].cls}`}>
                        {ORDER_META[o.status].label}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="mb-1.5 flex items-center justify-between text-[10.5px] text-tx3">
                <span>广告位</span>
                <button className="hover:text-acc" onClick={() => setTab("ads")}>全部 →</button>
              </div>
              <div className="overflow-hidden rounded-lg border border-line bg-bg1">
                {overviewAds.length === 0 ? (
                  <div className="px-3 py-4 text-[11px] text-tx3">// 暂无广告位</div>
                ) : (
                  overviewAds.map((a) => (
                    <div
                      key={a.id}
                      className="grid grid-cols-[minmax(0,1fr)_120px_80px_66px] items-baseline gap-2 border-b border-line px-3 py-2 text-[12px] last:border-b-0"
                    >
                      <span className="truncate text-tx">{a.name}</span>
                      <span className="text-[11px] text-tx3">
                        预算 {fmtMoney(a.budget)} · 消耗 {fmtMoney(a.spend)}
                      </span>
                      <span className="text-[11px] text-tx3">{AD_CHANNEL_LABEL[a.channel] ?? a.channel}</span>
                      <span className={`justify-self-start rounded border px-1.5 py-[1px] text-[9.5px] ${AD_STATUS_META[a.status].cls}`}>
                        {AD_STATUS_META[a.status].label}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* 订单 */}
      {tab === "orders" && (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-line pb-2 text-[11px]">
            {orderFilterChips.map((f) => (
              <button
                key={f.id}
                className={`rounded border px-1.5 py-0.5 ${
                  statusFilter === f.id ? "border-acc text-acc" : "border-line text-tx3 hover:border-acc"
                }`}
                onClick={() => setStatusFilter(f.id)}
              >
                {f.label}
                {f.id !== "all" && (
                  <span className="ml-1 text-[10px] text-tx3">
                    {orders.filter((o) => o.status === f.id).length}
                  </span>
                )}
              </button>
            ))}
            <input
              className="ml-auto w-[200px] rounded border border-line bg-bg1 px-2 py-0.5 text-[11px] text-tx outline-none placeholder:text-tx3 focus:border-acc"
              placeholder="grep 客户 / 商品…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="overflow-hidden rounded-lg border border-line bg-bg1">
            <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[10.5px] text-tx3">
              <span>~/biz/orders</span>
              <span>{visibleOrders.length} shown · {orders.length} total</span>
            </div>
            {visibleOrders.length === 0 ? (
              <div className="px-4 py-12 text-center text-[12px] text-tx3">
                {orders.length === 0
                  ? "// 还没有订单 —— 输入 biz.order.new 陈静 | 29 | pro 订阅 | alipay 记一笔"
                  : "// 当前过滤条件没有匹配的订单"}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[760px]">
                  <div className="grid grid-cols-[78px_minmax(0,1fr)_86px_66px_66px_120px] gap-2 border-b border-line px-3 py-1 text-[9.5px] text-tx3">
                    <span>时间</span>
                    <span>客户 / 商品</span>
                    <span className="text-right">金额</span>
                    <span>渠道</span>
                    <span>状态</span>
                    <span className="text-right">操作</span>
                  </div>
                  {visibleOrders.map((o) => (
                    <div
                      key={o.id}
                      className="grid grid-cols-[78px_minmax(0,1fr)_86px_66px_66px_120px] items-baseline gap-2 border-b border-line px-3 py-2 text-[12px] last:border-b-0"
                    >
                      <span className="text-[10.5px] text-tx3">{fmtDateTime(o.createdAt)}</span>
                      <span className="min-w-0 truncate text-tx2">
                        {o.customerName} · {o.item}
                        {orderSuffix(o) && (
                          <span className="ml-1 text-[10.5px] text-tx3">{orderSuffix(o)}</span>
                        )}
                      </span>
                      <span className={`justify-self-end ${o.status === "refunded" ? "text-tx3 line-through" : "text-acc"}`}>
                        {fmtMoney(o.amount)}
                      </span>
                      <span className="text-[11px] text-tx3">{CHANNEL_LABEL[o.channel] ?? o.channel}</span>
                      <span className={`justify-self-start rounded border px-1.5 py-[1px] text-[9.5px] ${ORDER_META[o.status].cls}`}>
                        {ORDER_META[o.status].label}
                      </span>
                      <span className="flex justify-end gap-1.5 text-[10px]">
                        {canWrite && o.status === "pending" && (
                          <button
                            className="rounded border border-line px-1.5 py-0.5 text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
                            onClick={() => void payOrder(o)}
                            disabled={busy}
                          >
                            支付
                          </button>
                        )}
                        {canWrite && o.status === "paid" && (
                          <button
                            className="rounded border border-err/50 px-1.5 py-0.5 text-err hover:bg-err/10 disabled:opacity-40"
                            onClick={() => void refundOrder(o)}
                            disabled={busy}
                          >
                            退款
                          </button>
                        )}
                        {o.status === "refunded" && <span className="text-tx3">—</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="border-t border-line px-3 py-1.5 text-[10px] text-tx3">
              // 一期为本地记账，不接真实支付网关 · 已支付可退款，退款后不计入净收入
            </div>
          </div>
        </div>
      )}

      {/* 订阅方案 */}
      {tab === "plans" && (
        <div className="overflow-hidden rounded-lg border border-line bg-bg1">
          <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[10.5px] text-tx3">
            <span>~/biz/plans</span>
            <span>{plans.length} plans · MRR {fmtMoney(digest?.mrr ?? 0)}</span>
          </div>
          {plans.length === 0 ? (
            <div className="px-4 py-12 text-center text-[12px] text-tx3">
              // 还没有订阅方案 —— 输入 biz.plan.new pro | 29 | monthly | 62
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                <div className="grid grid-cols-[minmax(0,1fr)_100px_80px_80px_80px_110px] gap-2 border-b border-line px-3 py-1 text-[9.5px] text-tx3">
                  <span>方案</span>
                  <span>价格</span>
                  <span className="text-right">订阅</span>
                  <span className="text-right">MRR</span>
                  <span>状态</span>
                  <span className="text-right">操作</span>
                </div>
                {plans.map((p) => (
                  <div
                    key={p.id}
                    className="grid grid-cols-[minmax(0,1fr)_100px_80px_80px_80px_110px] items-baseline gap-2 border-b border-line px-3 py-2 text-[12px] last:border-b-0"
                  >
                    <span className="min-w-0 truncate text-tx">
                      <b className="font-medium">{p.name}</b>
                      {p.projectName && <span className="ml-1 text-[10.5px] text-tx3">· {p.projectName}</span>}
                    </span>
                    <span className="text-tx2">{fmtMoney(p.price)}/{CYCLE_LABEL[p.cycle]}</span>
                    <span className="justify-self-end text-tx2">{p.subscribers}</span>
                    <span className="justify-self-end text-acc">{fmtMoney(p.mrr)}</span>
                    <span className={`justify-self-start rounded border px-1.5 py-[1px] text-[9.5px] ${PLAN_STATUS_META[p.status].cls}`}>
                      {PLAN_STATUS_META[p.status].label}
                    </span>
                    <span className="flex justify-end">
                      {canWrite && (
                        <button
                          className="rounded border border-line px-1.5 py-0.5 text-[10px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
                          onClick={() => void togglePlan(p)}
                          disabled={busy}
                        >
                          {p.status === "active" ? "停售" : "上架"}
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="border-t border-line px-3 py-1.5 text-[10px] text-tx3">
            // MRR = 月付价格 × 订阅人数；年付按 12 个月摊平 · 停售方案不计入 MRR
          </div>
        </div>
      )}

      {/* 广告位 */}
      {tab === "ads" && (
        <div className="overflow-hidden rounded-lg border border-line bg-bg1">
          <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[10.5px] text-tx3">
            <span>~/biz/ads</span>
            <span>{ads.length} ads · 消耗 {fmtMoney(digest?.adSpend ?? 0)}</span>
          </div>
          {ads.length === 0 ? (
            <div className="px-4 py-12 text-center text-[12px] text-tx3">
              // 还没有广告位 —— 输入 biz.ad.new banner-home | 1500 | web
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[760px]">
                <div className="grid grid-cols-[minmax(0,1fr)_80px_150px_70px_130px] gap-2 border-b border-line px-3 py-1 text-[9.5px] text-tx3">
                  <span>广告位</span>
                  <span>渠道</span>
                  <span className="text-right">预算 / 消耗</span>
                  <span>状态</span>
                  <span className="text-right">操作</span>
                </div>
                {ads.map((a) => (
                  <div
                    key={a.id}
                    className="grid grid-cols-[minmax(0,1fr)_80px_150px_70px_130px] items-baseline gap-2 border-b border-line px-3 py-2 text-[12px] last:border-b-0"
                  >
                    <span className="min-w-0 truncate text-tx">
                      {a.name}
                      {a.projectName && <span className="ml-1 text-[10.5px] text-tx3">· {a.projectName}</span>}
                    </span>
                    <span className="text-[11px] text-tx3">{AD_CHANNEL_LABEL[a.channel] ?? a.channel}</span>
                    <span className="justify-self-end text-[11px] text-tx2">
                      {fmtMoney(a.budget)} / <span className={a.spend > a.budget ? "text-err" : "text-tx3"}>{fmtMoney(a.spend)}</span>
                    </span>
                    <span className={`justify-self-start rounded border px-1.5 py-[1px] text-[9.5px] ${AD_STATUS_META[a.status].cls}`}>
                      {AD_STATUS_META[a.status].label}
                    </span>
                    <span className="flex justify-end gap-1.5 text-[10px]">
                      {canWrite && a.status !== "active" && a.status !== "ended" && (
                        <button
                          className="rounded border border-line px-1.5 py-0.5 text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
                          onClick={() => void setAdStatus(a, "active")}
                          disabled={busy}
                        >
                          上线
                        </button>
                      )}
                      {canWrite && a.status === "active" && (
                        <button
                          className="rounded border border-line px-1.5 py-0.5 text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
                          onClick={() => void setAdStatus(a, "paused")}
                          disabled={busy}
                        >
                          暂停
                        </button>
                      )}
                      {canWrite && a.status !== "ended" && (
                        <button
                          className="rounded border border-err/50 px-1.5 py-0.5 text-err hover:bg-err/10 disabled:opacity-40"
                          onClick={() => void setAdStatus(a, "ended")}
                          disabled={busy}
                        >
                          结束
                        </button>
                      )}
                      {a.status === "ended" && <span className="text-tx3">—</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="border-t border-line px-3 py-1.5 text-[10px] text-tx3">
            // 预算 / 消耗为本地记账 · CTR、结算明细与第三方广告平台对接留到后续
          </div>
        </div>
      )}

      <div className="mt-3 text-[10px] text-tx3">
        // 订阅方案 · 支付流水 · 广告位 · 本地记账，真实支付网关与广告平台接入留到后续
      </div>
    </div>
  );
}
