import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionGuard, RequirePerm } from "../common/permission.guard";
import { StatsService } from "./stats.service";

interface CollectRow {
  sessionId: string;
  userId?: string | null;
  path: string;
  refUrl?: string | null;
  durationMs?: number;
}

/**
 * 访问统计接口：
 *   POST /api/stats/collect  — 前端批量上报 page_view（无鉴权，匿名访客也能写）
 *   GET  /api/stats/overview — 聚合 PV/UV/trend/top（需登录）
 */
@Controller("stats")
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  /** 无鉴权：匿名访客也能上报 sessionId（前端 localStorage 生成） */
  @Post("collect")
  collect(
    @Body() body: CollectRow | CollectRow[],
    @Req() req: Request & { headers: Record<string, string | undefined> },
  ) {
    const ua = (req.headers["user-agent"] ?? "").slice(0, 512);
    const rows = Array.isArray(body) ? body : [body];
    const toInsert = rows.map((r) => ({
      sessionId: r.sessionId,
      userId: r.userId ?? null,
      path: r.path || "/",
      refUrl: r.refUrl ?? null,
      ua,
      durationMs: r.durationMs ?? 0,
    }));
    return this.stats.bulkInsert(toInsert).then((n) => ({ ok: true, inserted: n }));
  }

  /** 站点访问数据属于 admin 的管理视图，member 无读权限 */
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePerm("stats:read")
  @Get("overview")
  overview(
    @Query("days") days: number = 7,
  ) {
    return this.stats.overview(Math.min(Math.max(days, 1), 90));
  }
}
