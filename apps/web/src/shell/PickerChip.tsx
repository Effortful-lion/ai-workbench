import { useEffect, useRef, useState } from "react";

export interface PickerItem {
  /** 选项 id；null = 自动/默认项（◎ 标记） */
  id: string | null;
  /** 芯片与列表行显示文本 */
  name: string;
  /** 行尾附加标签（如 ★默认 / 跟随全局） */
  tag?: string;
  /** 行尾状态灯文本（如 ●ok） */
  statusText?: string;
  /** 状态灯颜色类（如 text-acc / text-err） */
  statusClass?: string;
}

interface Props {
  items: PickerItem[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** 浮层水平对齐：right=芯片右缘 / left=芯片左缘 */
  align?: "left" | "right";
  /** 浮层展开方向：down=向下（默认）/ up=向上（贴底输入区场景） */
  direction?: "up" | "down";
  /** 浮层标题栏文本 */
  head?: string;
  /** 芯片按钮附加样式（截断/宽度约束） */
  chipClass?: string;
  /** 芯片悬停提示 */
  title?: string;
}

/** 终端风通用选择芯片：◇ 当前项 ▾ → 浮层列表（↑↓/⏎/Esc 键盘导航、外点关闭）。
 *  全应用统一的选择交互：ModelPicker 与 Agent 选择器均基于此组件。 */
export default function PickerChip({
  items, value, onChange, align = "right", direction = "down", head = "◇ 选择", chipClass, title,
}: Props) {
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  // 浮层外点击关闭
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const current = items.find((i) => (i.id ?? null) === (value ?? null)) ?? null;

  const toggle = () => {
    if (open) return setOpen(false);
    setIdx(Math.max(0, items.findIndex((i) => i === current)));
    setOpen(true);
  };

  const pick = (it: PickerItem) => {
    onChange(it.id);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((v) => (v + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((v) => (v - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(items[idx]);
    }
  };

  return (
    <div ref={rootRef} className="relative inline-flex flex-col" onKeyDown={onKeyDown}>
      <button
        type="button"
        className={`flex min-w-0 items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
          current && current.id !== null
            ? "border border-acc text-acc hover:bg-acc/10"
            : "border border-line text-tx3 hover:border-acc hover:text-acc"
        } ${chipClass ?? ""}`}
        onClick={toggle}
        title={title ?? current?.name ?? "选择"}
      >
        <span className="truncate">◇ {current?.name ?? items[0]?.name ?? "…"}</span>
        <span className="flex-none">▾</span>
      </button>
      {open && (
        <div
          className={`absolute ${direction === "up" ? "bottom-[calc(100%+4px)]" : "top-[calc(100%+4px)]"} z-50 w-72 overflow-hidden rounded-md border border-line bg-bg1 shadow-[0_8px_32px_#000a] ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div className="flex items-center justify-between border-b border-line bg-bg2 px-3 py-1.5 text-[10px] text-tx3">
            <span>{head}</span>
            <span>// ↑↓ · ⏎</span>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {items.map((it, i) => {
              const cur = (it.id ?? null) === (value ?? null);
              return (
                <button
                  key={it.id ?? "auto"}
                  type="button"
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] ${
                    i === idx ? "bg-bg2" : ""
                  } ${cur ? "text-acc" : "text-tx2 hover:text-tx1"}`}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => pick(it)}
                >
                  <span className={it.id === null || cur ? "text-acc" : "text-tx3"}>
                    {it.id === null ? "◎" : cur ? "●" : "○"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{it.name}</span>
                  {it.tag && <span className="flex-none text-[9px] text-tx3">{it.tag}</span>}
                  {it.statusText && (
                    <span className={`flex-none text-[9px] ${it.statusClass ?? ""}`}>{it.statusText}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
