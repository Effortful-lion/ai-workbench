import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { displayName, useAuthStore, type AuthUser } from "../stores/auth";
import { useToastStore } from "../stores/toast";

/** 修改昵称：顶栏身份块点击后弹出，终端风格小窗 */
export default function NicknameDialog({ onClose }: { onClose: () => void }) {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [value, setValue] = useState(displayName(user));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const save = async () => {
    const nickname = value.trim();
    if (!nickname) {
      setErr("昵称不能为空");
      return;
    }
    if (Array.from(nickname).length > 20) {
      setErr("昵称最多 20 个字符");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const next = await api<AuthUser>("/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ nickname }),
      });
      setUser(next);
      useToastStore.getState().push("昵称已更新");
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 px-4 font-mono"
      onClick={onClose}
    >
      <div
        className="w-[360px] rounded-lg border border-line bg-bg1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[11px] text-tx3">
          <span className="text-err">●</span>
          <span className="text-warn">●</span>
          <span className="text-acc">●</span>
          <span className="ml-2">~/profile/nickname</span>
        </div>
        <div className="flex flex-col gap-3 p-4 text-[13px]">
          <label className="flex items-center gap-2">
            <span className="w-16 flex-none text-tx3">nick:</span>
            <input
              ref={inputRef}
              className="min-w-0 flex-1 border-b border-line bg-transparent py-1 text-tx outline-none focus:border-acc"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={20}
              onKeyDown={(e) => e.key === "Enter" && void save()}
            />
          </label>
          <div className="text-[10.5px] leading-relaxed text-tx3">
            // 昵称展示在首页招呼、顶栏与评论区；账号 @{user?.username} 不可修改
          </div>
          {err && <div className="text-xs text-err">✗ {err}</div>}
          <div className="flex items-center justify-end gap-2">
            <button
              className="rounded border border-line px-3 py-1 text-[11px] text-tx3 transition-colors hover:border-acc hover:text-acc"
              onClick={onClose}
            >
              esc 取消
            </button>
            <button
              className="rounded border border-acc/50 px-3 py-1 text-[11px] text-acc transition-colors hover:bg-acc/10 disabled:opacity-40"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? "⠋ 保存中" : "⏎ 保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
