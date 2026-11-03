import { useState } from "react";
import { useAuthStore } from "../../stores/auth";
import { useUiStore } from "../../stores/ui";

export default function LoginScreen() {
  const setSession = useAuthStore((s) => s.setSession);
  const { theme, toggleTheme } = useUiStore();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const raw = await res.text();
      if (!res.ok) {
        // 后端没启动 → Vite proxy 返回空/非 JSON
        let data: any = null;
        try { data = raw ? JSON.parse(raw) : null; } catch { /* 非 JSON */ }
        throw new Error(
          data?.error ?? data?.message ??
          (!res.ok && res.status >= 502 && res.status <= 504 ? "后端服务未启动（请 pnpm dev:server）" :
           !raw ? "后端无响应（server 未启动？）" : `请求失败 HTTP ${res.status}`)
        );
      }
      const data = raw ? JSON.parse(raw) : {};
      setSession(data.user, data.tokens);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid-bg flex h-full flex-col items-center justify-center gap-8 font-mono">
      <div className="text-2xl font-bold tracking-wider">
        <span className="text-acc">⌘</span> AI-WORKBENCH
      </div>

      <div className="w-[340px] rounded-lg border border-line bg-bg1">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[11px] text-tx3">
          <span className="text-err">●</span>
          <span className="text-warn">●</span>
          <span className="text-acc">●</span>
          <span className="ml-2">~/auth/{mode}</span>
        </div>
        <div className="flex flex-col gap-3 p-4 text-[13px]">
          <label className="flex items-center gap-2">
            <span className="w-16 text-tx3">user:</span>
            <input
              className="flex-1 border-b border-line bg-transparent py-1 text-tx outline-none focus:border-acc"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-16 text-tx3">pass:</span>
            <input
              type="password"
              className="flex-1 border-b border-line bg-transparent py-1 text-tx outline-none focus:border-acc"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </label>
          {err && <div className="text-xs text-err">✗ {err}</div>}
          <button
            className="mt-1 rounded border border-line py-1.5 text-xs text-tx2 transition-colors hover:border-acc hover:text-acc disabled:opacity-40"
            disabled={busy || !username || !password}
            onClick={submit}
          >
            {busy ? "⠋ ..." : mode === "login" ? "⏎ login" : "⏎ register"}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          className="text-[11px] text-tx3 hover:text-acc"
          onClick={() => setMode((m) => (m === "login" ? "register" : "login"))}
        >
          {mode === "login" ? "没有账号？→ register" : "已有账号？→ login"}
        </button>

        <span className="text-line">|</span>

        {/* 主题切换：终端提示符 `~/theme` + 两态图标，不突兀 */}
        <button
          className="flex items-center gap-1.5 text-[11px] text-tx3 transition-colors hover:text-acc"
          onClick={toggleTheme}
          title={`当前 ${theme === "dark" ? "终端暗" : "纸面暖"}，点击切换`}
        >
          <span>{theme === "dark" ? "◐" : "◑"}</span>
          <span>{theme === "dark" ? "~/theme dark" : "~/theme warm"}</span>
        </button>
      </div>
    </div>
  );
}
