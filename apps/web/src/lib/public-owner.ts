import { useEffect, useState } from "react";

export interface PublicOwnerDto {
  username: string;
  nickname: string;
}

/** 进程内缓存：一次拉取，多次挂载复用（游客首页 ⇄ 顶栏） */
let cached: PublicOwnerDto | null = null;
let pending: Promise<PublicOwnerDto | null> | null = null;

function fetchOwner(): Promise<PublicOwnerDto | null> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  pending = fetch("/api/profile/owner-public")
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as PublicOwnerDto;
      cached = data?.username ? data : null;
      return cached;
    })
    .catch(() => null)
    .finally(() => {
      pending = null;
    });
  return pending;
}

/**
 * 站点主人的公开身份（username / nickname）。
 * 游客没有账号上下文，需要用 owner 的 username 拼 /b /p /t /c 公开页地址。
 */
export function usePublicOwner(enabled: boolean): PublicOwnerDto | null {
  const [owner, setOwner] = useState<PublicOwnerDto | null>(cached);
  useEffect(() => {
    if (!enabled || cached) return;
    let alive = true;
    void fetchOwner().then((d) => {
      if (alive && d) setOwner(d);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return owner;
}
