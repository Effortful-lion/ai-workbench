import { useToastStore } from "../stores/toast";

const COLOR: Record<string, string> = {
  info: "border-line text-tx2",
  warn: "border-warn/60 text-warn",
  err: "border-err/60 text-err",
};

/** 终端风格 toast：右下角飘一条，3.5s 自动消失 */
export default function ToastHost() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);

  if (items.length === 0) return null;
  const t = items[0];

  return (
    <div className="pointer-events-none fixed bottom-[40px] right-4 z-50">
      <div
        className={`pointer-events-auto rounded border bg-bg1/95 px-3 py-1.5 font-mono text-[11px] shadow-lg backdrop-blur ${COLOR[t.kind]}`}
      >
        <span className="mr-1 text-acc">▸</span>
        {t.text}
        <button
          className="ml-2 text-tx3 hover:text-tx"
          onClick={() => dismiss(t.id)}
        >
          ×
        </button>
      </div>
    </div>
  );
}
