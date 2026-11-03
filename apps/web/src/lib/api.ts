import { useAuthStore } from "../stores/auth";
import { useToastStore } from "../stores/toast";

/** 带鉴权的 fetch 封装：401 时自动用 refreshToken 续一次；彻底过期弹 toast */
export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const { accessToken, refreshToken, setSession, clear } = useAuthStore.getState();

  const doFetch = (token: string | null) => {
    // FormData 由浏览器自动带 multipart boundary，不能强行覆盖 content-type
    const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
    return fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(isForm ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  };

  let res = await doFetch(accessToken);
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
  return res.json() as Promise<T>;
}
