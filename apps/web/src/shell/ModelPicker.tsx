import { useEffect, useRef, useState } from "react";
import type { ModelDto } from "@aiwb/shared";
import { api } from "../lib/api";

interface Item {
  id: string | null;
  name: string;
  tag?: string;
  status?: ModelDto["status"];
}

interface Props {
  /** 当前模型 id；null = ◎ 自动（服务端挑默认） */
  value: string | null;
  onChange: (modelId: string | null) => void;
  /** 浮层对齐方向：right=芯片右缘（KB 面板），left=芯片左缘（主页） */
  align?: "left" | "right";
}

const STATUS_DOT: Record<ModelDto["status"], string> = {
  ok: "text-acc",
  untested: "text-warn",
  error: "text-err",
};

/** 终端风模型选择芯片：◇ 名称 ▾ → 浮层列表（↑↓/⏎/Esc），仅列 status=ok 的 chat 模型，
 *  首项「◎ 自动」表示交给服务端挑默认模型。视觉规范：bg-bg1+border-line、6px 圆角、无毛玻璃。 */
export default function ModelPicker({ value, onChange, align = "right" }: Props) {
  const [models, setModels] = useState<ModelDto[] | null>(null);
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<ModelDto[]>("/models")
      .then((ms) => setModels(ms.filter((m) => m.kind === "chat" && m.status === "ok")))
      .catch(() => setModels([]));
  }, []);

  // 浮层外点击关闭
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const items: Item[] = [
    { id: null, name: "自动（服务端默认）", tag: "跟随全局" },
    ...(models ?? []).map((m) => ({
      id: m.id,
      name: `${m.provider}/${m.modelName}`,
      tag: m.isDefault ? "★默认" : undefined,
      status: m.status,
    })),
  ];
  const current = models?.find((m) => m.id === value) ?? null;

  const toggle = () => {
    if (open) return setOpen(false);
    setIdx(Math.max(0, items.findIndex((i) => i.id === (value ?? null))));
    setOpen(true);
  };

  const pick = (it: Item) => {
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
        className={`rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
          current ? "border border-acc text-acc hover:bg-acc/10" : "border border-line text-tx3 hover:border-acc hover:text-acc"
        }`}
        onClick={toggle}
        title={current ? `当前模型：${current.provider}/${current.modelName}` : "跟随服务端默认模型"}
      >
        ◇ {current ? `${current.provider}/${current.modelName}` : "自动"} ▾
      </button>
      {open && (
        <div
          className={`absolute top-[calc(100%+4px)] z-50 w-72 overflow-hidden rounded-md border border-line bg-bg1 shadow-[0_8px_32px_#000a] ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div className="flex items-center justify-between border-b border-line bg-bg2 px-3 py-1.5 text-[10px] text-tx3">
            <span>◇ 选择模型</span>
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
                  <span className={it.id === null ? "text-acc" : cur ? "text-acc" : "text-tx3"}>
                    {it.id === null ? "◎" : cur ? "●" : "○"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{it.name}</span>
                  {it.tag && <span className="flex-none text-[9px] text-tx3">{it.tag}</span>}
                  {it.status && <span className={`flex-none text-[9px] ${STATUS_DOT[it.status]}`}>●{it.status}</span>}
                </button>
              );
            })}
            {models !== null && models.length === 0 && (
              <div className="px-3 py-2 text-[10px] leading-relaxed text-tx3">// 尚无可用 chat 模型 · 先到模型管理接入</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
