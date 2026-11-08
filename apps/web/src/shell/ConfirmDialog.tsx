import { useEffect } from "react";
import { useConfirmStore } from "../stores/confirm";

/** 应用内二次确认弹窗（终端窗口风，替代浏览器原生 confirm）。
 *  全局常驻于 App 根节点，任何模块通过 useConfirmStore.getState().ask({...}) 唤起：
 *  点遮罩 / Esc / 取消按钮关闭，⏎ 或确认按钮执行 onConfirm。 */
export default function ConfirmDialog() {
  const confirming = useConfirmStore((s) => s.confirming);
  const close = useConfirmStore((s) => s.close);

  // 打开期间 Esc 关闭
  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, close]);

  if (!confirming) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-bg/80" onClick={close}>
      <div
        className="w-[min(440px,92%)] overflow-hidden rounded-lg border border-line bg-bg1 shadow-[0_0_24px_#00E59B18]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line bg-bg2 px-3 py-2 text-[11px] text-tx3">
          <span className="text-acc">?</span>
          <span>// {confirming.title}</span>
          <button className="ml-auto text-tx3 hover:text-acc" onClick={close}>
            ✕
          </button>
        </div>
        <div className="px-4 py-4 text-[13px] leading-relaxed text-tx">{confirming.message}</div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button
            className="rounded border border-line px-3 py-1 text-[11px] text-tx2 hover:border-acc hover:text-acc"
            onClick={close}
          >
            Esc 取消
          </button>
          <button
            className={`rounded border px-3 py-1 text-[11px] hover:bg-acc/10 ${
              confirming.danger ? "border-err text-err" : "border-acc text-acc"
            }`}
            onClick={() => {
              const fn = confirming.onConfirm;
              close();
              fn();
            }}
            autoFocus
          >
            {confirming.confirmText ?? "⏎ 确认"}
          </button>
        </div>
      </div>
    </div>
  );
}
