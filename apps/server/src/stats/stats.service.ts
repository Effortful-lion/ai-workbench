import { Inject, Injectable } from "@nestjs/common";
import { desc, eq, sql, and, gt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DB, type Db } from "../db/db.module";
import { visits } from "../db/schema";

export interface Overview {
  /** 近 N 天总 PV */
  pv: number;
  /** 近 N 天独立 session 数（UV by sessionId） */
  uv: number;
  /** 近 N 天总停留时长（毫秒） */
  totalDurationMs: number;
  /** 平均单次会话时长（毫秒） */
  avgDurationMs: number;
  /** 今日 PV vs 昨日 PV */
  todayPv: number;
  yesterdayPv: number;
  /** 近 7 天每日 PV */
  trend: { date: string; pv: number; uv: number }[];
  /** 热门页面 Top10 */
  topPages: { path: string; pv: number }[];
  /** 今日活跃 session 数（过去 1h 有访问） */
  activeSessions1h: number;
  /** 今日独立访客（过去 24h 首次出现的 sessionId） */
  newVisitors24h: number;
}

@Injectable()
export class StatsService {
  /** 内存级 rate limit：同 sessionId 10s 内最多 1 次 collect（防刷） */
  private readonly collectWindow = new Map<string, number>();
  private readonly RATE_WINDOW_MS = 10_000;

  constructor(@Inject(DB) private readonly db: Db) {}

  /** 批量写入 visit（前端 batch 上报） */
  async bulkInsert(rows: Array<{
    sessionId: string;
    userId?: string | null;
    path: string;
    refUrl?: string | null;
    ua: string;
    durationMs?: number;
  }>): Promise<number> {
    // 清理过期 rate-limit 记录（避免 Map 无限增长）
    const now = Date.now();
    for (const [sid, ts] of this.collectWindow) {
      if (now - ts > this.RATE_WINDOW_MS * 2) this.collectWindow.delete(sid);
    }

    // 对每个 sessionId 做 10s 限频
    const deduped = rows.filter((r) => {
      const last = this.collectWindow.get(r.sessionId) ?? 0;
      if (now - last < this.RATE_WINDOW_MS) return false;
      this.collectWindow.set(r.sessionId, now);
      return true;
    });

    const toInsert = deduped.map((r) => ({
      id: randomUUID(),
      sessionId: r.sessionId,
      // collect 是无鉴权接口，不信任前端传来的 userId（防止伪造外键）
      userId: null as string | null,
      path: r.path,
      refUrl: r.refUrl ?? null,
      ua: r.ua.slice(0, 512),
      durationMs: r.durationMs ?? 0,
    }));
    if (toInsert.length === 0) return 0;
    await this.db.insert(visits).values(toInsert);
    return toInsert.length;
  }

  /** 按时间范围（天）拉 overview */
  async overview(days = 7): Promise<Overview> {
    const cutoff = Date.now() - days * 86400 * 1000;

    // 基础 PV / UV / duration
    const rows = await this.db
      .select({
        pv: sql<number>`COUNT(*)`,
        uv: sql<number>`COUNT(DISTINCT ${visits.sessionId})`,
        totalDurationMs: sql<number>`COALESCE(SUM(${visits.durationMs}),0)`,
      })
      .from(visits)
      .where(gt(visits.createdAt, new Date(cutoff)));

    const base = rows[0] ?? { pv: 0, uv: 0, totalDurationMs: 0 };
    const avgDurationMs = base.pv > 0 ? Math.round(base.totalDurationMs / base.pv) : 0;

    // 今日 vs 昨日
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400 * 1000;
    const todayPv = await this.countAfter(startOfToday);
    const yesterdayPv = await this.countAfter(startOfYesterday, startOfToday);

    // 7 日趋势（SQLite date 函数：createdAt 存 unix epoch 秒，直接 unixepoch）
    const trendRows = await this.db
      .select({
        date: sql<string>`date(${visits.createdAt}, 'unixepoch')`,
        pv: sql<number>`COUNT(*)`,
        uv: sql<number>`COUNT(DISTINCT ${visits.sessionId})`,
      })
      .from(visits)
      .where(gt(visits.createdAt, new Date(cutoff)))
      .groupBy(sql`date(${visits.createdAt}, 'unixepoch')`)
      .orderBy(sql`date(${visits.createdAt}, 'unixepoch')`);
    const trend: { date: string; pv: number; uv: number }[] = (trendRows as any[]).map((r) => ({
      date: r.date,
      pv: r.pv,
      uv: r.uv,
    }));

    // 热门页面 Top10
    const topRows = await this.db
      .select({
        path: visits.path,
        pv: sql<number>`COUNT(*)`,
      })
      .from(visits)
      .where(gt(visits.createdAt, new Date(cutoff)))
      .groupBy(visits.path)
      .orderBy(desc(sql<number>`COUNT(*)`))
      .limit(10);
    const topPages = topRows.map((r: any) => ({ path: r.path, pv: r.pv }));

    // 过去 1h 活跃 session
    const active1h = await this.db
      .select({ count: sql<number>`COUNT(DISTINCT ${visits.sessionId})` })
      .from(visits)
      .where(gt(visits.createdAt, new Date(Date.now() - 3600 * 1000)));

    // 过去 24h 内首次出现的 sessionId = 新访客
    const nowSec = Math.floor(Date.now() / 1000);
    const cutoff24hSec = nowSec - 86400;
    const first24h = await this.db
      .select({ sessionId: visits.sessionId })
      .from(visits)
      .where(gt(visits.createdAt, new Date(cutoff24hSec * 1000)));
    const sessionIds = new Set((first24h as any[]).map((r) => r.sessionId));
    // 再查这些 sessionId 是否在 24h 前出现过（原生 SQL 必须用秒，DB 存 unix epoch 秒）
    const firstCount = sessionIds.size > 0
      ? await this.db
          .select({ count: sql<number>`COUNT(DISTINCT ${visits.sessionId})` })
          .from(visits)
          .where(sql`${visits.sessionId} IN (${[...sessionIds].map(() => "?").join(",")}) AND ${visits.createdAt} < ${cutoff24hSec}`)
          .all()
      : [{ count: 0 }];
    const previously = (firstCount as any[])[0]?.count ?? 0;
    const newVisitors24h = Math.max(0, sessionIds.size - previously);

    return {
      pv: base.pv,
      uv: base.uv,
      totalDurationMs: base.totalDurationMs,
      avgDurationMs,
      todayPv,
      yesterdayPv,
      trend,
      topPages,
      activeSessions1h: (active1h as any[])[0]?.count ?? 0,
      newVisitors24h,
    };
  }

  private async countAfter(startMs: number, endMs?: number): Promise<number> {
    // DB createdAt 存 unix epoch 秒；Drizzle 的 gt(..., new Date(x)) 会自动转秒
    // 但原生 SQL 模板必须手动转秒
    const w = endMs !== undefined
      ? and(gt(visits.createdAt, new Date(startMs)), sql`${visits.createdAt} < ${Math.floor(endMs / 1000)}`)
      : gt(visits.createdAt, new Date(startMs));
    const r = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(visits)
      .where(w);
    return (r as any[])[0]?.count ?? 0;
  }
}
