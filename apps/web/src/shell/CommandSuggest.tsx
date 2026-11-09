import { useEffect, useMemo, useRef, useState } from "react";
import { matchCommands, type Command } from "../lib/commands";

interface Props {
  text: string;
  /** 选中一项后：返回该项，父组件执行并清空输入 */
  onPick: (cmd: Command) => void;
  /** Enter 直接发送（不走命令）的回调 */
  onClose?: () => void;
  /** 浮层方向：up=向上（默认，聊天栏输入框贴屏幕底）/ down=向下（首页 Hero 输入框在页面中部） */
  direction?: "up" | "down";
}

/** 斜杠命令下拉：输入 "/" 时按 direction 浮现，↑↓ 选择，Enter 确认，Esc 关闭 */
export default function CommandSuggest({ text, onPick, onClose, direction = "up" }: Props) {
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const visible = text.startsWith("/");
  const filtered = useMemo(() => (visible ? matchCommands(text) : []), [text, visible]);

  // 每次输入变化时把 active 归零，防止越界
  useEffect(() => {
    setActive(0);
  }, [text]);

  // 自动把选中项滚到可视区
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, filtered.length]);

  useEffect(() => {
    if (!visible) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      } else if (e.key === "Enter") {
        // 不拦截 Enter，让 form submit 处理（如果当前选中就 pick 后阻止 submit）
        if (filtered[active]) {
          e.preventDefault();
          e.stopPropagation();
          onPick(filtered[active]);
        }
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [visible, filtered, active, onPick, onClose]);

  if (!visible || filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      className={`absolute left-0 right-0 z-20 max-h-[320px] overflow-auto rounded-lg border border-acc/60 bg-bg1 ${
        direction === "up"
          ? "bottom-full mb-1 shadow-[0_-8px_24px_rgba(0,0,0,0.4)]"
          : "top-full mt-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
      }`}
    >
      {filtered.map((c, i) => (
        <button
          key={c.cmd}
          data-i={i}
          onMouseEnter={() => setActive(i)}
          onMouseDown={(e) => {
            e.preventDefault(); // 防止 input 失焦
            onPick(c);
          }}
          className={
            "flex w-full items-center gap-3 px-3 py-2 text-left font-mono transition-colors " +
            (i === active ? "bg-acc/10 text-acc" : "text-tx hover:bg-bg2")
          }
        >
          <span className="min-w-[80px] text-[12px] font-bold">{c.label}</span>
          <span className="truncate text-[11px] text-tx3">{c.desc}</span>
          <span className="ml-auto text-[10px] text-tx3">
            {c.kind === "panel" ? "panel" : "action"}
          </span>
        </button>
      ))}
      <div className="sticky bottom-0 border-t border-line bg-bg1/95 px-3 py-1.5 font-mono text-[10px] text-tx3 backdrop-blur">
        ⌃ 可用命令  ·  ↑↓ 选择  ·  ⏎ 执行  ·  Esc 关闭
      </div>
    </div>
  );
}
