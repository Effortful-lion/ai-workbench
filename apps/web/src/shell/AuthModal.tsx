import { useEffect } from "react";
import AuthForm from "../features/auth/AuthForm";
import { useAuthModal } from "../stores/auth-modal";

/**
 * 登录浮层：挂在根节点（main.tsx），首页 / 公开页都能复用。
 * 登录成功后 onSuccess 关闭浮层，调用方所在页面状态保持不变。
 */
export default function AuthModal() {
  const { open, reason, close } = useAuthModal();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-bg/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="登录"
      onClick={close}
    >
      <div className="relative flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
        <button
          className="absolute -right-2 -top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-bg1 text-[11px] text-tx3 transition-colors hover:border-err hover:text-err"
          onClick={close}
          title="关闭（Esc）"
        >
          ✕
        </button>

        <div className="mb-4 flex items-center gap-2 text-[15px] font-bold tracking-wider">
          <img src="/icons/icon-32.png" alt="" className="h-7 w-7 rounded-[4px] border border-line" />
          AI-WORKBENCH
        </div>

        <AuthForm reason={reason} onSuccess={close} />
      </div>
    </div>
  );
}
