import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { asciiBar } from "../../lib/collector";

interface Overview {
  pv: number;
  uv: number;
  totalDurationMs: number;
  avgDurationMs: number;
  todayPv: number;
  yesterdayPv: number;
  trend: { date: string; pv: number; uv: number }[];
  topPages: { path: string; pv: number }[];
  activeSessions1h: number;
  newVisitors24h: number;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** 格式化路径：/models → ~/models，/ → 首页 */
function fmtPath(p: string): string {
  if (p === "/") return "~/ (首页)";
  return p.replace(/^\//, "~/");
}

/** 访问统计面板：PV/UV/热门页面/7日趋势（终端 ASCII bar chart 风格） */
export default function StatsPanel() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api<Overview>(`/stats/overview?days=${days}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [days]);

  // 无数据时引导
  if (!loading && (!data || (data.pv === 0 && data.uv === 0))) {
    return (
      <div className="mx-auto w-[min(860px,94%)] py-8 font-mono">
        <div className="mb-4 text-xs text-tx3">~/stats · 访问统计 · 近 {days} 天</div>
        <div className="rounded-lg border border-dashed border-line py-16 text-center text-xs text-tx3">
          还没有访问数据 —— 访问几个面板就能生成记录（前端自动采集）
          <div className="mt-3 text-[10px]">口径：PV=每次面板/路由切换，UV=按 sessionId 去重</div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto w-[min(860px,94%)] py-8 font-mono">
        <div className="text-xs text-tx3">~/stats · 加载失败（stats 模块需要登录）</div>
      </div>
    );
  }

  const maxTrend = Math.max(1, ...data.trend.map((t) => t.pv));
  const maxTop = Math.max(1, ...data.topPages.map((t) => t.pv));
  const pvDelta = data.yesterdayPv > 0 ? ((data.todayPv - data.yesterdayPv) / data.yesterdayPv * 100).toFixed(0) : null;

  return (
    <div className="mx-auto w-[min(900px,94%)] py-8 font-mono">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-xs text-tx3">~/stats · 访问统计</div>
        <div className="flex gap-1">
          {[1, 7, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded border px-2 py-0.5 text-[10px] ${
                days === d ? "border-acc text-acc" : "border-line text-tx3 hover:text-tx"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* 顶部大数字卡 */}
      <div className="mb-4 grid grid-cols-4 gap-2">
        <StatCard label="总 PV" value={fmtNum(data.pv)} hint={`近 ${days} 天`} />
        <StatCard label="总 UV" value={fmtNum(data.uv)} hint={`独立 session`} />
        <StatCard
          label="今日 PV"
          value={fmtNum(data.todayPv)}
          hint={
            pvDelta !== null
              ? `${pvDelta.startsWith("-") ? pvDelta : "+" + pvDelta}% vs 昨日`
              : `昨日 ${fmtNum(data.yesterdayPv)}`
          }
        />
        <StatCard label="活跃 1h" value={fmtNum(data.activeSessions1h)} hint={`新访客 ${fmtNum(data.newVisitors24h)}/24h`} />
      </div>

      <div className="mb-4 rounded border border-line p-3">
        <div className="mb-2 text-[11px] text-tx3">// 会话时长 · 近 {days} 天</div>
        <div className="flex gap-6 text-[12px]">
          <span>总停留: <span className="text-tx">{fmtMs(data.totalDurationMs)}</span></span>
          <span>平均: <span className="text-tx">{fmtMs(data.avgDurationMs)}</span> / 页</span>
        </div>
      </div>

      {/* 热门页面 */}
      <div className="mb-4 rounded border border-line p-3">
        <div className="mb-2 flex items-center justify-between text-[11px]">
          <span className="text-tx3">// 热门页面 Top {data.topPages.length}</span>
          <span className="text-tx3">PV</span>
        </div>
        <div className="flex flex-col gap-1">
          {data.topPages.map((p, i) => (
            <div key={p.path} className="flex items-center gap-2 text-[11px]">
              <span className="w-5 flex-none text-tx3 text-right">{i + 1}.</span>
              <span className="w-28 flex-none truncate text-tx">{fmtPath(p.path)}</span>
              <span className="text-acc">{asciiBar(p.pv, maxTop, 20)}</span>
              <span className="w-12 flex-none text-right text-tx3">{fmtNum(p.pv)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 7 日趋势 */}
      {data.trend.length > 0 && (
        <div className="mb-4 rounded border border-line p-3">
          <div className="mb-2 text-[11px] text-tx3">// {Math.min(days, 7)} 日 PV 趋势</div>
          <div className="flex flex-col gap-1">
            {data.trend.map((t) => (
              <div key={t.date} className="flex items-center gap-2 text-[11px]">
                <span className="w-20 flex-none text-tx3">{t.date}</span>
                <span className="text-acc">{asciiBar(t.pv, maxTrend, 24)}</span>
                <span className="w-12 flex-none text-right text-tx">{fmtNum(t.pv)}</span>
                <span className="w-12 flex-none text-right text-tx3">UV {fmtNum(t.uv)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 口径说明 */}
      <div className="text-[10px] text-tx3">
        // 口径：PV=每次面板/路由切换；UV=localStorage sessionId 去重（跨日同一浏览器仍同）；
        // 停留时长=离开页面前的毫秒数（前端 beforeunload/visibilitychange 上报）
      </div>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded border border-line bg-bg1 p-3">
      <div className="text-[10px] text-tx3">{label}</div>
      <div className="mt-1 text-[22px] font-bold text-acc">{value}</div>
      {hint && <div className="mt-1 text-[10px] text-tx3">{hint}</div>}
    </div>
  );
}
