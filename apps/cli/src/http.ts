import { saveConfig, type CliConfig } from "./config.js";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiBase(server: string): string {
  const s = server.replace(/\/+$/, "");
  return s.endsWith("/api") ? s : `${s}/api`;
}

export interface CallOptions {
  query?: Record<string, unknown>;
  body?: unknown;
  form?: FormData;
  timeoutMs?: number;
}

/** access token 过期时，同进程内的并发请求共用一次换票，避免 refresh token 旋转后互相失效 */
let refreshing: Promise<boolean> | null = null;

/** 这些接口的 401 是业务错误（密码错、票已废），换票没有意义还会掩盖真实原因 */
const NO_REFRESH_PATHS = new Set(["/auth/login", "/auth/logout", "/auth/refresh", "/auth/register", "/auth/code"]);

export async function callApi(
  cfg: CliConfig,
  method: string,
  path: string,
  opts: CallOptions = {},
): Promise<unknown> {
  const normalized = path.replace(/^\/api(\/|$)/, "/");

  let result = await send(cfg, method, normalized, opts);
  if (result.status === 401 && cfg.refreshToken && !cfg.noPersist && !NO_REFRESH_PATHS.has(normalized)) {
    if (await refreshTokens(cfg)) result = await send(cfg, method, normalized, opts);
  }

  if (!result.ok) {
    throw new ApiError(extractError(result.data) ?? `${result.status} ${result.statusText}`, result.status);
  }
  return result.data;
}

/** 用 refresh token 换新的一对 token 并落盘；失败返回 false，由调用方按原 401 处理 */
function refreshTokens(cfg: CliConfig): Promise<boolean> {
  if (!refreshing) {
    refreshing = doRefresh(cfg).finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function doRefresh(cfg: CliConfig): Promise<boolean> {
  try {
    const data = (await callApi(
      { server: cfg.server },
      "POST",
      "/auth/refresh",
      { body: { refreshToken: cfg.refreshToken } },
    )) as { tokens?: { accessToken?: string; refreshToken?: string } };
    const accessToken = data.tokens?.accessToken;
    if (!accessToken) return false;
    cfg.token = accessToken;
    // 每次刷新服务端都会旋转 refresh token，必须同步更新
    if (data.tokens?.refreshToken) cfg.refreshToken = data.tokens.refreshToken;
    saveConfig(cfg);
    return true;
  } catch {
    return false;
  }
}

interface RawResponse {
  ok: boolean;
  status: number;
  statusText: string;
  data: unknown;
}

async function send(cfg: CliConfig, method: string, normalized: string, opts: CallOptions): Promise<RawResponse> {
  const url = new URL(`${apiBase(cfg.server)}${normalized.startsWith("/") ? normalized : `/${normalized}`}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  }

  const headers: Record<string, string> = { accept: "application/json" };
  if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;
  // multipart 的 content-type 由 FormData 自动带 boundary，不能手写
  if (opts.body !== undefined && !opts.form) headers["content-type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    });
  } catch (e) {
    throw new ApiError(
      `无法连接 ${url.origin}：${e instanceof Error ? e.message : String(e)}（后端是否已启动？可用 --server 改地址）`,
      0,
    );
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, statusText: res.statusText, data };
}

function extractError(data: unknown): string | null {
  if (typeof data === "string") return data.slice(0, 300);
  if (!data || typeof data !== "object") return null;
  const m = (data as { message?: unknown }).message;
  if (Array.isArray(m)) return m.join("; ");
  if (typeof m === "string") return m;
  return null;
}
