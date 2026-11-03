import { create } from "zustand";

export type ToastKind = "info" | "warn" | "err";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
  /** 自动消失毫秒；0 = 不自动 */
  ttl: number;
}

interface ToastState {
  items: ToastItem[];
  push: (text: string, kind?: ToastKind, ttl?: number) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

/** 轻量 toast：全局单条，新的顶掉旧的（终端风格不搞堆叠） */
export const useToastStore = create<ToastState>()((set, get) => ({
  items: [],
  push: (text, kind = "info", ttl = 3500) => {
    const id = nextId++;
    set({ items: [{ id, kind, text, ttl }] });
    if (ttl > 0) {
      setTimeout(() => {
        get().dismiss(id);
      }, ttl);
    }
  },
  dismiss: (id) =>
    set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));
