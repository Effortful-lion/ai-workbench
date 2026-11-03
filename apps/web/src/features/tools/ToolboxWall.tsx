import { useEffect, useMemo, useState } from "react";
import type { ToolboxItemDto } from "@aiwb/shared";

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  items: ToolboxItemDto[];
  canWrite?: boolean;
  onOpen: (item: ToolboxItemDto) => void;
  onDelete?: (item: ToolboxItemDto) => void;
  emptyText?: string;
}

/** 快捷指令墙：分类过滤 + alias 卡片阵列 */
export default function ToolboxWall({ items, canWrite, onOpen, onDelete, emptyText }: Props) {
  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category))).sort(),
    [items],
  );
  const [cat, setCat] = useState("all");

  useEffect(() => {
    if (cat !== "all" && !categories.includes(cat)) setCat("all");
  }, [categories, cat]);

  const visible = cat === "all" ? items : items.filter((i) => i.category === cat);

  return (
    <>
      {/* 分类过滤 */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
        {["all", ...categories].map((c) => (
          <button
            key={c}
            className={`rounded border px-2 py-0.5 transition-colors ${
              cat === c
                ? "border-acc bg-bg2 text-acc"
                : "border-line text-tx3 hover:border-acc hover:text-acc"
            }`}
            onClick={() => setCat(c)}
          >
            #{c}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-tx3">
          {visible.length} / {items.length} aliases
        </span>
      </div>

      {/* 卡片阵列 */}
      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-4 py-12 text-center font-mono text-[12px] text-tx3">
          {emptyText ?? "// 这里还没有工具"}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5">
          {visible.map((item) => (
            <div
              key={item.id}
              className="group relative cursor-pointer rounded-md border border-line bg-bg1 p-3 transition-colors hover:border-acc hover:bg-bg2"
              onClick={() => onOpen(item)}
              title={item.kind === "file" ? item.fileName : item.url}
            >
              <div className="flex items-center gap-1.5 font-mono text-[13px] text-tx">
                <span className="text-acc">{item.kind === "file" ? "▤" : "▸"}</span>
                <span className="truncate">{item.name}</span>
                <span className="ml-auto flex-none text-[11px] text-acc opacity-0 transition-opacity group-hover:opacity-100">
                  {item.kind === "file" ? "↧" : "↗"}
                </span>
              </div>
              <div className="mt-0.5 truncate font-mono text-[10.5px] text-tx3">
                {item.kind === "file"
                  ? `${item.fileName ?? ""} · ${formatBytes(item.fileSize ?? 0)}`
                  : hostOf(item.url)}
              </div>
              <div className="mt-1.5 line-clamp-2 h-[38px] text-[12px] leading-[1.6] text-tx2">
                {item.desc || "// 暂无简介"}
              </div>
              <div className="mt-2 flex items-center justify-between font-mono text-[10.5px] text-tx3">
                <span className="text-tx2">
                  {item.kind === "file" ? "↧" : "↗"} {item.useCount} 次
                </span>
                <span>#{item.category}</span>
              </div>

              {canWrite && onDelete && (
                <button
                  className="absolute right-2 top-2 rounded border border-line bg-bg1 px-1 text-[10px] text-tx3 opacity-0 transition-opacity hover:border-err hover:text-err group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(item);
                  }}
                  title="从百宝箱移除"
                >
                  ✗
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
