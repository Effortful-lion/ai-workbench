import { useAuthStore } from "../stores/auth";
import { useToastStore } from "../stores/toast";

/** 带鉴权的 fetch 封装：401 时自动用 refreshToken 续一次；彻底过期弹 toast。
 *  默认 60s 超时兜底，防止服务端/代理挂死时按钮永远转圈；长请求（如 kb ask）调用方自行加大 */
export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 60_000,
): Promise<T> {
  const { accessToken, refreshToken, setSession, clear } = useAuthStore.getState();

  const doFetch = (token: string | null) => {
    // FormData 由浏览器自动带 multipart boundary，不能强行覆盖 content-type
    const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
    return fetch(`/api${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      headers: {
        ...(isForm ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  };

  let res: Response;
  try {
    res = await doFetch(accessToken);
  } catch (e) {
    // 只有超时才是「超时」；用户主动 abort（AbortController）原样抛出，交给调用方区分
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new Error("请求超时，请稍后重试");
    }
    throw e;
  }
  if (res.status === 401 && refreshToken) {
    const rr = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (rr.ok) {
      const data = await rr.json();
      setSession(data.user, data.tokens);
      res = await doFetch(data.tokens.accessToken);
    } else {
      clear();
      useToastStore.getState().push("会话已过期，请重新登录", "warn", 5000);
    }
  } else if (res.status === 401) {
    clear();
    useToastStore.getState().push("会话已过期，请重新登录", "warn", 5000);
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
  const { accessToken } = useAuthStore.getState();
  const res = await fetch(`/api${path}`, {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
  }
  return res.blob();
}
