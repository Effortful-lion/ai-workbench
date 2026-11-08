import { create } from "zustand";

export interface ConfirmRequest {
  /** 弹窗标题（标题栏 // 注释） */
  title: string;
  /** 正文提示 */
  message: string;
  /** 确认按钮文案，缺省「⏎ 确认」 */
  confirmText?: string;
  /** 危险操作：确认按钮红色描边（删除等破坏性动作） */
  danger?: boolean;
  /** 点确认后执行的动作 */
  onConfirm: () => void;
}

interface ConfirmStore {
  confirming: ConfirmRequest | null;
  /** 发起一次应用内二次确认（替代 window.confirm） */
  ask: (req: ConfirmRequest) => void;
  close: () => void;
}

/** 全局二次确认：任何模块都可 ask()，弹窗由根节点常驻的 <ConfirmDialog/> 渲染 */
export const useConfirmStore = create<ConfirmStore>((set) => ({
  confirming: null,
  ask: (req) => set({ confirming: req }),
  close: () => set({ confirming: null }),
}));
