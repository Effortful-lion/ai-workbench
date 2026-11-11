import { useEffect, useState } from "react";
import { useAuthStore } from "../stores/auth";
import { useChatStore } from "../stores/chat";
import { PANEL_META, usePanelStore } from "../stores/panel";
import { useUiStore } from "../stores/ui";

const MODE_LABEL: Record<string, string> = {
  A: "A·对话",
  B: "B·工作",
  C: "C·cli",
};

export default function StatusBar({ mode }: { mode: "A" | "B" | "C" }) {
  const [now, setNow] = useState(() => new Date());
  const { active } = usePanelStore();
  const { connected, modelHint } = useChatStore();
  const theme = useUiStore((s) => s.theme);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  return (
    <footer className="flex h-[26px] flex-none items-center justify-between border-t border-line bg-bg1 px-3 font-mono text-[10px] text-tx3">
      <div className="flex items-center gap-3">
        {/* 游客没有工作台状态，明确标注只读 */}
        <span className="text-acc">[{user ? MODE_LABEL[mode] : "guest · 只读"}]</span>
        {active && <span>{PANEL_META[active].path}</span>}
      </div>
      <div className="flex items-center gap-3">
        {user && modelHint && <span>llm: {modelHint}</span>}
        {/* 未登录不连 socket，不展示断线状态 */}
        {user && (
          <span className={connected ? "text-acc" : "text-err"}>
            {connected ? "● ws" : "○ ws"}
          </span>
        )}
        <span>{theme === "dark" ? "◐ dark" : "◑ warm"}</span>
        <span>
          {hh}:{mm}:{ss}
        </span>
      </div>
    </footer>
  );
}
