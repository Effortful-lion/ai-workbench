/** 日程管理（schedule 模块）共享类型 —— 任务 = 时间 + 提醒 + 状态 */

export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_STATUSES = ["pending", "done", "canceled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface ScheduleTaskDto {
  id: string;
  title: string;
  notes: string;
  /** 地点 / 会议链接 */
  location: string;
  startsAt: number;
  endsAt: number;
  durationMin: number;
  /** 提醒时间；null 表示不提醒 */
  remindAt: number | null;
  priority: TaskPriority;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleTaskInput {
  title: string;
  /** 开始时间：毫秒时间戳或 ISO 时间串 */
  startsAt: number | string;
  durationMin?: number;
  priority?: TaskPriority;
  location?: string;
  notes?: string;
  /** 缺省 = 开始前 10 分钟；传 null 表示不提醒 */
  remindAt?: number | string | null;
}

export interface ScheduleTaskPatchInput {
  title?: string;
  notes?: string;
  location?: string;
  startsAt?: number | string;
  durationMin?: number;
  priority?: TaskPriority;
  status?: TaskStatus;
  remindAt?: number | string | null;
}
