import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "warm";

interface UiState {
  theme: Theme;
  cliOpen: boolean;
  paletteOpen: boolean;
  /** 移动端（<lg）工作态下显示聊天还是面板；桌面端忽略 */
  mobileView: "chat" | "panel";
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
  setCli: (open: boolean) => void;
  setPalette: (open: boolean) => void;
  setMobileView: (v: "chat" | "panel") => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "dark",
      cliOpen: false,
      paletteOpen: false,
      mobileView: "chat",
      toggleTheme: () => set((s) => ({ theme: s.theme === "dark" ? "warm" : "dark" })),
      setTheme: (theme) => set({ theme }),
      setCli: (cliOpen) => set({ cliOpen }),
      setPalette: (paletteOpen) => set({ paletteOpen }),
      setMobileView: (mobileView) => set({ mobileView }),
    }),
    {
      name: "aiwb-ui",
      partialize: (s) => ({ theme: s.theme }), // 只持久化主题，CLI/面板状态每次会话重置
    },
  ),
);
