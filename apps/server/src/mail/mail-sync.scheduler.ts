import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { and, isNotNull, isNull, lt, or } from "drizzle-orm";
import { DB, type Db } from "../db/db.module";
import { mailAccounts } from "../db/schema";
import { MailService } from "./mail.service";

/** 默认 60 秒检查一次；设 0 可关闭（测试环境或不想常连 IMAP 时） */
const DEFAULT_INTERVAL_MS = 60_000;

/**
 * 邮件增量同步调度器。
 *
 * 做法是「定时轮询 + 服务端增量」而不是 IMAP IDLE：
 * - IDLE 需要为每个账户长期占用一条连接，QQ/163 对并发连接数与空闲时长都有限制，掉线还需重连退避；
 * - 增量同步本身按「上次同步时间 - 1 天」取 UID，轮询一次的成本是一次 SEARCH + 少量 FETCH，60 秒一轮足够「准实时」。
 *
 * 只挑「上次同步早于一个周期」的账户，避免重复劳动；同一 owner 并发时由 MailService 的互斥锁兜底。
 */
@Injectable()
export class MailSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("mail-sync");
  private readonly intervalMs =
    Math.max(0, Number(process.env.MAIL_SYNC_INTERVAL_MS ?? DEFAULT_INTERVAL_MS)) || 0;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly inflight = new Set<string>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly mail: MailService,
  ) {}

  onModuleInit() {
    if (this.intervalMs <= 0) {
      this.log.log("▸ 邮件增量同步已关闭（MAIL_SYNC_INTERVAL_MS=0）");
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    // 不阻塞进程退出（dev 下 nest watch 重启更顺）
    this.timer.unref?.();
    this.log.log(`▸ 邮件增量同步已开启：每 ${Math.round(this.intervalMs / 1000)}s 检查一次`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 找出「该同步了」的账户，按 owner 触发一次增量同步 */
  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const staleBefore = new Date(Date.now() - this.intervalMs);
      const rows = await this.db
        .select({ ownerId: mailAccounts.ownerId })
        .from(mailAccounts)
        .where(
          and(
            isNotNull(mailAccounts.passwordEnc),
            or(isNull(mailAccounts.lastSyncedAt), lt(mailAccounts.lastSyncedAt, staleBefore)),
          ),
        );
      const owners = [...new Set(rows.map((r) => r.ownerId))];

      for (const ownerId of owners) {
        if (this.inflight.has(ownerId)) continue;
        this.inflight.add(ownerId);
        try {
          const r = await this.mail.sync(ownerId);
          if (r.created > 0) {
            this.log.log(`▸ 增量同步：新增 ${r.created} 封（owner ${ownerId.slice(0, 8)}）`);
          }
        } catch (e) {
          // 单个账户/owner 失败不影响其他账户，下一轮自然重试
          this.log.warn(`增量同步失败（owner ${ownerId.slice(0, 8)}）：${(e as Error).message}`);
        } finally {
          this.inflight.delete(ownerId);
        }
      }
    } catch (e) {
      this.log.warn(`同步调度异常：${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
