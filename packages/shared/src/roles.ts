/** 用户角色：权限即边界，Agent 可用工具 = 用户权限子集 */
export const ROLES = ["owner", "member", "guest"] as const;
export type Role = (typeof ROLES)[number];

/** 权限点：'<module>:<action>'，'*' 通配 */
export type Permission = string;

/** 角色 → 权限集。guest 只读且脱敏 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ["*"],
  member: [
    "me:read", "tools:read", "tools:write", "tools:custom",
    "kb:read", "kb:write",
    "projects:read",
    "code:read",
    "schedule:read",
    "notify:read", "notify:write",
    "models:read",
    "agents:read", "agents:write",
    "chat:use", "cli:use",
  ],
  guest: ["me:read", "tools:read"],
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
