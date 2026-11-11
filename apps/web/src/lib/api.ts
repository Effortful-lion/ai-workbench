import { useAuthStore, type AuthUser } from "../stores/auth";
import { useToastStore } from "../stores/toast";

let refreshing: Promise<boolean> | null = null;

/**
 * 用 httpOnly Cookie 里的 refresh token 换一张新的 accessToken。
 *
 * - accessToken 只存在内存，刷新页面后必然过期，靠这里续；
 * - 并发请求同时 401 时合并成一次刷新（refresh token 是旋转的，并发会互相作废）；
 * - 失败返回 false，由调用方决定是否清登录态。
 */
export function refreshSession(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        credentials: "include",
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { user?: AuthUser; tokens?: { accessToken?: string } };
      const token = data?.tokens?.accessToken;
      if (!data?.user || !token) return false;
      useAuthStore.getState().setSession(data.user, { accessToken: token });
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** 登录态彻底失效：清 store + 提示 */
function expire() {
  useAuthStore.getState().clear();
  useToastStore.getState().push("会话已过期，请重新登录", "warn", 5000);
}

/** 带鉴权的 fetch 封装：accessToken 缺失或 401 时自动续一次；彻底过期弹 toast。
 *  默认 60s 超时兜底，防止服务端/代理挂死时按钮永远转圈；长请求（如 kb ask）调用方自行加大 */
export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 60_000,
): Promise<T> {
  const doFetch = (token: string | null) => {
    // FormData 由浏览器自动带 multipart boundary，不能强行覆盖 content-type
    const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
    return fetch(`/api${path}`, {
      ...init,
      credentials: "include",
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      headers: {
        ...(isForm ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  };

  // 刷新页面后内存里没有 accessToken，先用 Cookie 静默续一次，避免首屏全 401
  if (!useAuthStore.getState().accessToken && useAuthStore.getState().user) {
    if (!(await refreshSession())) expire();
  }

  let res: Response;
  try {
    res = await doFetch(useAuthStore.getState().accessToken);
  } catch (e) {
    // 只有超时才是「超时」；用户主动 abort（AbortController）原样抛出，交给调用方区分
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new Error("请求超时，请稍后重试");
    }
    throw e;
  }

  if (res.status === 401 && useAuthStore.getState().user) {
    if (await refreshSession()) {
      res = await doFetch(useAuthStore.getState().accessToken);
    }
    if (res.status === 401) expire();
  }

  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
  // DELETE 等无返回值接口响应体为空（200/204），直接 res.json() 会抛 SyntaxError，
  // 导致调用方的 await reload() 永远执行不到（表现为「删了但界面不动，刷新后才生效」）
  const raw = await res.text();
  if (!raw) return undefined as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

/** 下载二进制（如邮件附件）：同样带鉴权头，不解析 JSON */
export async function apiBlob(path: string): Promise<Blob> {
  const get = () =>
    fetch(`/api${path}`, {
      credentials: "include",
      headers: useAuthStore.getState().accessToken
        ? { authorization: `Bearer ${useAuthStore.getState().accessToken}` }
        : {},
    });
  let res = await get();
  if (res.status === 401 && (await refreshSession())) res = await get();
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
  }
  return res.blob();
}
