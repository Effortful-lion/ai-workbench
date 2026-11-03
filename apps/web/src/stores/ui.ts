import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "warm";

interface UiState {
  theme: Theme;
  cliOpen: boolean;
  paletteOpen: boolean;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
  setCli: (open: boolean) => void;
  setPalette: (open: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "dark",
      cliOpen: false,
      paletteOpen: false,
      toggleTheme: () => set((s) => ({ theme: s.theme === "dark" ? "warm" : "dark" })),
      setTheme: (theme) => set({ theme }),
      setCli: (cliOpen) => set({ cliOpen }),
      setPalette: (paletteOpen) => set({ paletteOpen }),
    }),
    {
      name: "aiwb-ui",
      partialize: (s) => ({ theme: s.theme }), // 只持久化主题，CLI/面板状态每次会话重置
    },
  ),
);
