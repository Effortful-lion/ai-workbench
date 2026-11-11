/** 用户角色：权限即边界，Agent 可用工具 = 用户权限子集 */
export const ROLES = ["owner", "member", "guest"] as const;
export type Role = (typeof ROLES)[number];

/** 权限点：'<module>:<action>'，'*' 通配 */
export type Permission = string;

/**
 * 角色 → 权限集。
 *
 * 本站是个人站：数据归属只有两种——admin（owner）与普通 user（member）。
 * admin 的模块默认「数据 + 读写」都归 admin，member 一概不开放；只有少数对外展示/讨论性质的模块
 * 才给 member 开只读：
 *
 * - 博客：admin 的文章（read），评论由所有登录用户参与（评论接口只要求登录，不设权限点）
 * - 个人简历 / 联系信息 / 百宝箱：本来就有公开页（/p /t /c），登录后给只读
 * - GitHub 观察窗：纯只读，开放给所有人
 * - 站内信：只看自己收到的，且非 admin 只收到「讨论类」消息（服务端过滤）
 * - CLI 终端：所有人可用（命令本身受各自权限约束）
 * - 对话：个人数据，用自己的身份
 *
 * 其余模块（模型、AI 助手、执行历史、知识库、项目、代码、日程、邮件、商业化、
 * 客户、流水线、工具管理、对象存储、访问统计）一律 `owner only`。
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ["*"],
  member: [
    // 身份：昵称是 header 里唯一可改项
    "me:read", "me:write",
    // 展示类（admin 的数据，只读）
    "blog:read",
    "resume:read",
    "contact:read",
    "toolbox:read",
    // GitHub 观察窗：只读
    "github:read",
    // 个人域
    "notify:read", "notify:write",
    "chat:use", "cli:use",
    // 模型：只有「列可选模型 + 切模型」的用量权限，没有管理读（面板）/写
    "models:use",
    // Agent 工具目录（chat 执行时按角色裁剪工具集，只拿到只读类工具）
    "tools:read",
  ],
  guest: ["me:read", "blog:read", "github:read"],
};

export function hasPermission(role: Role, perm: Permission): boolean {
  const owned = ROLE_PERMISSIONS[role] ?? [];
  if (owned.includes("*")) return true;
  const [mod] = perm.split(":");
  return owned.includes(perm) || owned.includes(`${mod}:*`);
}

/** 按角色过滤工具子集（Agent 执行时注入） */
export function filterByRole<T extends { permission: Permission }>(
  role: Role,
  tools: readonly T[],
): T[] {
  return tools.filter((t) => hasPermission(role, t.permission));
}
