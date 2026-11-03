import { useEffect, useState } from "react";
import type { ToolboxItemDto } from "@aiwb/shared";
import ToolboxWall from "./ToolboxWall";

/** 游客公开只读百宝箱 /t/:username */
export default function PublicToolboxPage({ username }: { username: string }) {
  const [items, setItems] = useState<ToolboxItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/toolbox/public/${encodeURIComponent(username)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? `HTTP ${res.status}`);
        }
        return (await res.json()) as ToolboxItemDto[];
      })
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [username]);

  return (
    <div className="grid-bg flex min-h-full flex-col items-center px-4 py-8 font-mono">
      <div className="mb-4 flex w-[min(880px,100%)] items-center justify-between text-[11px] text-tx3">
        <span>
          <span className="text-acc">▸</span> AI-WORKBENCH · public toolbox
        </span>
        <a className="hover:text-acc" href="/">
          ← 返回工作台
        </a>
      </div>

      <div className="w-[min(880px,100%)] overflow-hidden rounded-lg border border-line bg-bg1">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[11px] text-tx3">
          <span className="text-err">●</span>
          <span className="text-warn">●</span>
          <span className="text-acc">●</span>
          <span className="ml-2 truncate">~/t/{username}/aliases</span>
          <span className="ml-auto flex-none rounded border border-line px-1.5 text-[10px]">
            read-only
          </span>
        </div>

        <div className="px-4 py-4">
          {items ? (
            <ToolboxWall
              items={items}
              onOpen={(item) => window.open(item.url, "_blank", "noopener,noreferrer")}
              emptyText="// 该用户的百宝箱还没有公开工具"
            />
          ) : error ? (
            <div className="py-6 text-[12px]">
              <div className="text-err">✗ {error}</div>
              <div className="mt-2 text-tx3">// 用户名可能不存在，或公开数据读取失败</div>
            </div>
          ) : (
            <div className="flex h-[160px] items-center justify-center text-[12px] text-tx3">
              ⠋ 读取公开百宝箱…
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 w-[min(880px,100%)] text-[10px] text-tx3">
        // public read-only · 点击卡片打开工具 · /t/{username}
      </div>
    </div>
  );
}
