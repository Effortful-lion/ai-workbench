import type { CliConfig } from "./config.js";

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

export async function callApi(
  cfg: CliConfig,
  method: string,
  path: string,
  opts: { query?: Record<string, unknown>; body?: unknown; form?: FormData; timeoutMs?: number } = {},
): Promise<unknown> {
  const normalized = path.replace(/^\/api(\/|$)/, "/");
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
  if (!res.ok) {
    throw new ApiError(extractError(data) ?? `${res.status} ${res.statusText}`, res.status);
  }
  return data;
}

function extractError(data: unknown): string | null {
  if (typeof data === "string") return data.slice(0, 300);
  if (!data || typeof data !== "object") return null;
  const m = (data as { message?: unknown }).message;
  if (Array.isArray(m)) return m.join("; ");
  if (typeof m === "string") return m;
  return null;
}
