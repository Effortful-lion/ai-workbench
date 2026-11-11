import type { Role } from "./roles.js";

/**
 * 当前登录用户（对外可见字段，绝不含密码哈希）。
 * - `username`：账号句柄，注册时由邮箱前缀派生，用于公开页路径 `/p/:username` 等；
 * - `nickname`：展示昵称，注册时自动生成，可修改；首页招呼语、顶栏、评论区都用它；
 * - `email`：配置种入的 admin 没有邮箱，为 null。
 */
export interface AuthUserDto {
  id: string;
  username: string;
  email: string | null;
  nickname: string;
  role: Role;
}

export interface AuthTokensDto {
  accessToken: string;
  refreshToken: string;
}

export interface AuthSessionDto {
  user: AuthUserDto;
  tokens: AuthTokensDto;
}

/** 发送验证码结果：未配置 SMTP 时走开发兜底，直接把验证码回显给前端 */
export interface SendCodeResult {
  sent: boolean;
  /** 有效期（秒） */
  ttl: number;
  /** 仅开发兜底（未配置 SMTP）时出现 */
  devCode?: string;
}
