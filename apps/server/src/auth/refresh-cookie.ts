/**
 * refresh token 的 Cookie 通道。
 *
 * 目的：让浏览器端「刷新页面仍保持登录」，同时不把长期凭证暴露给 JS。
 * - httpOnly：XSS 拿不到；
 * - path=/api/auth：只有换票/登出接口会带上，业务请求不携带；
 * - sameSite=lax：跨站请求不带，配合前端同源部署即可防 CSRF；
 * - secure：生产用 HTTPS 时把 COOKIE_SECURE 设为 true。
 *
 * accessToken 仍然只放在内存（前端 store 不持久化），过期由 /auth/refresh 续。
 */
const COOKIE_NAME = "aiwb_rt";
const COOKIE_PATH = "/api/auth";
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

/** 生产环境应置 true（HTTPS）；本地 http 下必须为 false，否则浏览器不会存 */
const secure = (process.env.COOKIE_SECURE ?? "false") === "true";

/** 只描述我们用到的 Express API，避免为两个方法引入 @types/express */
interface CookieWriter {
  cookie: (name: string, value: string, opts: Record<string, unknown>) => unknown;
  clearCookie: (name: string, opts: Record<string, unknown>) => unknown;
}

interface CookieReader {
  headers: { cookie?: string };
}

const baseOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure,
  path: COOKIE_PATH,
};

export function setRefreshCookie(res: CookieWriter, token: string) {
  res.cookie(COOKIE_NAME, token, { ...baseOptions, maxAge: MAX_AGE_MS });
}

export function clearRefreshCookie(res: CookieWriter) {
  res.clearCookie(COOKIE_NAME, baseOptions);
}

/** 从 Cookie 头里取 refresh token（不引入 cookie-parser） */
export function readRefreshCookie(req: CookieReader): string {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() !== COOKIE_NAME) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return "";
}
