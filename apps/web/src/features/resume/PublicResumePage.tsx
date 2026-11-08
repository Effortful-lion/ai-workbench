import { useEffect, useState } from "react";
import type { ResumeDto } from "@aiwb/shared";
import ResumeCard from "./ResumeCard";
import PublicBackLink from "../public/PublicBackLink";

/** 游客公开只读页 /p/:username，不经过登录态 */
export default function PublicResumePage({ username }: { username: string }) {
  const [data, setData] = useState<ResumeDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/resume/public/${encodeURIComponent(username)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? `HTTP ${res.status}`);
        }
        return (await res.json()) as ResumeDto;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [username]);

  return (
    <div className="grid-bg flex min-h-full flex-col items-center px-4 py-8 font-mono">
      <div className="mb-4 flex w-[min(880px,100%)] items-center justify-between text-[11px] text-tx3">
        <span className="min-w-0 truncate">
          <span className="text-acc">▸</span> AI-WORKBENCH · public profile
        </span>
        <PublicBackLink />
      </div>

      <div className="w-[min(880px,100%)]">
        {data ? (
          <ResumeCard data={data} />
        ) : error ? (
          <div className="rounded-lg border border-line bg-bg1 px-5 py-6 text-[12px]">
            <div className="text-err">✗ 404 · {error}</div>
            <div className="mt-2 text-tx3">该公开档案不存在、尚未填写，或用户名有误</div>
          </div>
        ) : (
          <div className="flex h-[220px] items-center justify-center rounded-lg border border-line bg-bg1 text-[12px] text-tx3">
            ⠋ 读取公开档案…
          </div>
        )}
      </div>

      <div className="mt-4 w-[min(880px,100%)] text-[10px] text-tx3">
        // public read-only · 由 AI-WORKBENCH 提供 · /p/{username}
      </div>
    </div>
  );
}
