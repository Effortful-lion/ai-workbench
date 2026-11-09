import { useMemo, useState } from "react";
import type { BlogPublicPostDto } from "@aiwb/shared";
import { Icon } from "../../lib/icons";
import {
  CATEGORY_META, CATEGORY_TABS, SORT_MODES, categoryKeyOf, formatDate, sortPosts, tickWidth,
  type SortMode,
} from "./blogUtils";

interface Props {
  posts: BlogPublicPostDto[];
  /** 第二个参数 = 被点卡片元素，供上层做 FLIP 首帧 */
  onOpen: (slug: string, el?: HTMLElement) => void;
  activeSlug?: string;
  emptyText?: string;
}

/** 图纸卡片墙：分类导航词 + 排序键 + 网格卡片（悬停 2px 上浮 + 裁切角标点亮） */
export default function BlogCardWall({ posts, onOpen, activeSlug, emptyText }: Props) {
  const [cat, setCat] = useState<string>("#全部");
  const [sort, setSort] = useState<SortMode>("最新");

  const maxChars = useMemo(() => Math.max(0, ...posts.map((p) => p.charCount)), [posts]);
  // 编号稳定取自发布时间序（与排序/分类无关）
  const orderMap = useMemo(() => {
    const sorted = [...posts].sort((a, b) => b.publishedAt - a.publishedAt);
    return new Map(sorted.map((p, i) => [p.id, i + 1]));
  }, [posts]);
  const catKey = categoryKeyOf(cat);
  const shown = useMemo(() => {
    const filtered = catKey ? posts.filter((p) => p.category === catKey) : posts;
    return sortPosts(filtered, sort);
  }, [posts, catKey, sort]);

  const cycleSort = () => {
    const ix = SORT_MODES.indexOf(sort);
    setSort(SORT_MODES[(ix + 1) % SORT_MODES.length]);
  };

  return (
    <div>
      {/* 分类导航词 + 排序 */}
      <div className="flex flex-wrap items-center gap-1 text-[10.5px] font-mono">
        {CATEGORY_TABS.map((c) => (
          <button
            key={c}
            className={`rounded px-2 py-0.5 transition-colors ${
              c === cat ? "bg-acc/10 text-acc" : "text-tx3 hover:text-acc"
            }`}
            onClick={() => setCat(c)}
          >
            {c}
          </button>
        ))}
        <span className="ml-2 text-tx3">{cat} · {shown.length} 篇</span>
        <button
          className="ml-auto flex items-center gap-1.5 rounded border border-line px-2 py-0.5 text-tx3 transition-colors hover:border-acc/50 hover:text-acc"
          onClick={cycleSort}
          title="切换排序：最新 / 最早 / 最长"
        >
          <Icon name="sort" size={12} />
          <span>{sort}</span>
        </button>
      </div>

      {/* 卡片网格 */}
      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] items-start gap-3.5 max-[900px]:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
        {shown.length === 0 && (
          <div className="col-span-full py-12 text-center text-[11px] text-tx3">
            {emptyText ?? "// 暂无文章"}
          </div>
        )}
        {shown.map((p) => {
          const listed = (orderMap.get(p.id) ?? 1) - 1;
          return (
            <article
              key={p.id}
              role="button"
              tabIndex={0}
              aria-label={`阅读《${p.title}》`}
              className={`group relative flex cursor-pointer flex-col gap-2 border bg-bg1 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-acc/40 hover:bg-bg2 focus-visible:border-acc focus-visible:outline-none ${
                activeSlug === p.slug ? "border-acc/60 bg-bg2" : "border-line"
              }`}
              onClick={(e) => onOpen(p.slug, e.currentTarget)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(p.slug, e.currentTarget);
                }
              }}
            >
              {/* 图纸裁切角标：悬停延伸并点亮 */}
              <span className="pointer-events-none absolute -left-px -top-px h-2.5 w-2.5 border-l border-t border-tx3/60 transition-all duration-200 group-hover:h-4 group-hover:w-4 group-hover:border-acc" />
              <span className="pointer-events-none absolute -bottom-px -right-px h-2.5 w-2.5 border-b border-r border-tx3/60 transition-all duration-200 group-hover:h-4 group-hover:w-4 group-hover:border-acc" />

              <div className="flex items-baseline gap-2.5 font-mono text-[9.5px] tracking-[0.08em]">
                <span className="text-tx3 transition-colors group-hover:text-acc">
                  #{String(listed + 1).padStart(3, "0")}
                </span>
                <span className="text-acc/75">{CATEGORY_META[p.category].label}</span>
              </div>

              <h3 className="line-clamp-2 min-h-[2.6em] text-[13.5px] font-medium leading-relaxed text-tx transition-colors group-hover:text-acc">
                {p.title}
              </h3>
              <p className="line-clamp-2 text-[11.5px] leading-relaxed text-tx2">{p.summary}</p>

              <div className="mt-auto flex items-center gap-2.5 border-t border-dashed border-line pt-2 font-mono text-[9.5px] text-tx3">
                <span>{formatDate(p.publishedAt)}</span>
                <span className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-sm bg-bg">
                  <span
                    className="block h-full rounded-sm bg-tx3/50 transition-colors group-hover:bg-acc"
                    style={{ width: `${tickWidth(p.charCount, maxChars)}%` }}
                  />
                </span>
                {p.commentCount > 0 && (
                  <span className="flex flex-none items-center gap-0.5">
                    <Icon name="comment" size={11} />
                    {p.commentCount}
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
