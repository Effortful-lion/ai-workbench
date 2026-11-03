/** 站内信 / 通知中心（notify 模块）共享类型 —— 系统消息 + 日程提醒 + 重要邮件 */

export const NOTIFICATION_TYPES = ["system", "schedule", "mail"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  isRead: boolean;
  /** 关联业务 id：日程任务 id / 邮件 id，用于跳转对应面板 */
  sourceId: string | null;
  /** 幂等键，扫描生成时使用，避免重复提醒 */
  dedupeKey: string | null;
  createdAt: number;
}

export interface NotificationInput {
  type?: NotificationType;
  title: string;
  body?: string;
}

export interface NotificationDigestDto {
  total: number;
  unread: number;
  /** 今日新增条数（本地时区） */
  today: number;
  types: Record<NotificationType, number>;
  /** 如「3 unread · 今日 2 条 · 日程 2 · 邮件 1」 */
  summary: string;
}

/** 扫描结果：日程提醒 + 重要邮件，按 dedupeKey 幂等 */
export interface NotificationScanResult {
  created: number;
  skipped: number;
  schedule: number;
  mail: number;
}
