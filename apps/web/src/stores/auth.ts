import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AuthUser {
  id: string;
  /** 账号句柄：注册时由邮箱前缀派生，公开页路径用它 */
  username: string;
  /** 登录邮箱；配置种入的 admin 没有邮箱 */
  email?: string | null;
  /** 展示昵称：注册时自动生成，可修改 */
  nickname?: string;
  role: "owner" | "member" | "guest";
}

interface Tokens {
  accessToken: string;
  /** 浏览器端不使用（refresh token 在 httpOnly Cookie 里），CLI 才会读 */
  refreshToken?: string;
}

interface AuthState {
  user: AuthUser | null;
  /** 只存内存：刷新页面后由 /auth/refresh 用 Cookie 换新的 */
  accessToken: string | null;
  setSession: (user: AuthUser, tokens: Tokens) => void;
  /** 只更新用户信息（如改完昵称），token 不动 */
  setUser: (user: AuthUser) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      setSession: (user, tokens) => set({ user, accessToken: tokens.accessToken }),
      setUser: (user) => set({ user }),
      clear: () => set({ user: null, accessToken: null }),
    }),
    {
      name: "aiwb-auth",
      // 只持久化用户画像：长期凭证在 httpOnly Cookie，短期 accessToken 不落盘
      partialize: (s) => ({ user: s.user }) as unknown as AuthState,
      // v2：清掉历史版本写在 localStorage 里的 accessToken / refreshToken
      version: 2,
      migrate: (persisted) =>
        ({ user: (persisted as { user?: AuthUser | null } | undefined)?.user ?? null }) as unknown as AuthState,
    },
  ),
);

/** 展示用名称：昵称优先，老数据没昵称时退回账号名 */
export function displayName(user: AuthUser | null | undefined): string {
  return user?.nickname?.trim() || user?.username || "";
}
