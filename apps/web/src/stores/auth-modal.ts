import { create } from "zustand";

/**
 * 登录浮层：游客在首页触发需要登录的功能时原地弹窗，
 * 登录成功后浮层自动关闭，页面状态（输入框内容、所在位置）不丢。
 */
interface AuthModalState {
  open: boolean;
  /** 被拦下时的说明文案，例如「登录后即可开始对话」 */
  reason: string | null;
  /** 请求登录：任一受限入口调用它 */
  requireLogin: (reason?: string) => void;
  close: () => void;
}

export const useAuthModal = create<AuthModalState>((set) => ({
  open: false,
  reason: null,
  requireLogin: (reason) => set({ open: true, reason: reason ?? null }),
  close: () => set({ open: false, reason: null }),
}));
