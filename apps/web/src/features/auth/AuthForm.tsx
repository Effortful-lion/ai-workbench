import { useEffect, useState } from "react";
import { useAuthStore } from "../../stores/auth";
import { useUiStore } from "../../stores/ui";
import { useToastStore } from "../../stores/toast";

/** 解析后端返回：Nest 默认错误体是 { statusCode, message, error } */
function parseBody(raw: string): { message?: string; error?: string; devCode?: string; user?: any; tokens?: any } {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** 后端未启动时 Vite proxy 会返回空体或 502，给一句人话 */
function describeFailure(status: number, raw: string, body: ReturnType<typeof parseBody>): string {
  if (body.message && (status === 400 || status === 409 || status === 401 || status === 429)) return body.message;
  if (status >= 502 && status <= 504) return "后端服务未启动（请 pnpm dev:server）";
  if (!raw) return "后端无响应（server 未启动？）";
  return body.error ?? body.message ?? `请求失败 HTTP ${status}`;
}

interface Props {
  /** 被拦截时说明为什么要登录，例如「登录后即可开始对话」 */
  reason?: string | null;
  /** 登录/注册成功（session 已写入 store） */
  onSuccess?: () => void;
  /** 全屏登录页需要主题切换；浮层里顶栏已有，避免重复 */
  showTheme?: boolean;
}

/**
 * 登录/注册表单：全屏登录页与登录浮层共用同一份逻辑与样式。
 * 只负责卡片本身，外层容器（居中/遮罩）由调用方决定。
 */
export default function AuthForm({ reason, onSuccess, showTheme }: Props) {
  const setSession = useAuthStore((s) => s.setSession);
  const { theme, toggleTheme } = useUiStore();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);

  // 验证码重发倒计时（与后端 60 秒冷却一致）
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  /** 切换登录/注册时清掉一次性的提示，保留已填的密码与邮箱 */
  const switchMode = () => {
    setErr(null);
    setHint(null);
    setCode("");
    setMode((m) => (m === "login" ? "register" : "login"));
  };

  const sendCode = async () => {
    if (!email.trim()) {
      setErr("请先填写邮箱");
      return;
    }
    setSending(true);
    setErr(null);
    setHint(null);
    try {
      const res = await fetch("/api/auth/code", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const raw = await res.text();
      const body = parseBody(raw);
      if (!res.ok) throw new Error(describeFailure(res.status, raw, body));
      setCooldown(60);
      if (body.devCode) {
        // 未配置 SMTP 的开发兜底：直接回显并填入，省得翻服务端日志
        setCode(body.devCode);
        setHint(`开发模式：验证码 ${body.devCode}（未配置 SMTP，已打印到服务端日志）`);
      } else {
        setHint(`验证码已发送至 ${email.trim()}，10 分钟内有效`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "发送失败");
    } finally {
      setSending(false);
    }
  };

  const submit = async () => {
    // 与 MinIO root 密码规则一致：注册密码至少 8 位
    if (mode === "register") {
      if (!email.trim()) {
        setErr("请填写邮箱");
        return;
      }
      if (password.length < 8) {
        setErr("密码至少 8 位（与对象存储 root 规则一致）");
        return;
      }
      if (!/^\d{6}$/.test(code.trim())) {
        setErr("请填写 6 位邮箱验证码");
        return;
      }
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          mode === "login" ? { username, password } : { email: email.trim(), password, code: code.trim() },
        ),
      });
      const raw = await res.text();
      const body = parseBody(raw);
      if (!res.ok) throw new Error(describeFailure(res.status, raw, body));
      setSession(body.user, body.tokens);
      if (mode === "register") {
        useToastStore
          .getState()
          .push(`账号 @${body.user?.username ?? ""} 已创建，昵称「${body.user?.nickname ?? ""}」可随时修改`, "info", 6000);
      }
      onSuccess?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    mode === "login" ? Boolean(username && password) : Boolean(email && password && code) && !busy;

  return (
    <div className="font-mono">
      <div className="w-[min(340px,calc(100vw-32px))] rounded-lg border border-line bg-bg1">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[11px] text-tx3">
          <span className="text-err">●</span>
          <span className="text-warn">●</span>
          <span className="text-acc">●</span>
          <span className="ml-2">~/auth/{mode}</span>
        </div>

        {reason && (
          <div className="border-b border-line bg-acc/5 px-3 py-2 text-[11px] leading-relaxed text-acc">
            › {reason}
          </div>
        )}

        <div className="flex flex-col gap-3 p-4 text-[13px]">
          {mode === "login" ? (
            <label className="flex items-center gap-2">
              <span className="w-16 text-tx3">user:</span>
              <input
                className="flex-1 border-b border-line bg-transparent py-1 text-tx outline-none focus:border-acc"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="账号名或邮箱"
                autoFocus
              />
            </label>
          ) : (
            <label className="flex items-center gap-2">
              <span className="w-16 text-tx3">mail:</span>
              <input
                type="email"
                className="flex-1 border-b border-line bg-transparent py-1 text-tx outline-none placeholder:text-tx3 focus:border-acc"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
              />
            </label>
          )}

          <label className="flex items-center gap-2">
            <span className="w-16 text-tx3">pass:</span>
            <input
              type="password"
              className="flex-1 border-b border-line bg-transparent py-1 text-tx outline-none placeholder:text-tx3 focus:border-acc"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "register" ? "至少 8 位" : ""}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              onKeyDown={(e) => e.key === "Enter" && mode === "login" && submit()}
            />
          </label>

          {mode === "register" && (
            <label className="flex items-center gap-2">
              <span className="w-16 text-tx3">code:</span>
              <input
                className="min-w-0 flex-1 border-b border-line bg-transparent py-1 text-tx outline-none placeholder:text-tx3 focus:border-acc"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="6 位数字"
                inputMode="numeric"
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
              <button
                type="button"
                className="flex-none rounded border border-line px-2 py-1 text-[11px] text-tx2 transition-colors hover:border-acc hover:text-acc disabled:opacity-40"
                disabled={sending || cooldown > 0 || !email.trim()}
                onClick={sendCode}
                title="发送邮箱验证码"
              >
                {sending ? "⠋ 发送" : cooldown > 0 ? `${cooldown}s` : "获取验证码"}
              </button>
            </label>
          )}

          {hint && <div className="text-[11px] leading-relaxed text-acc">› {hint}</div>}
          {err && <div className="text-xs text-err">✗ {err}</div>}

          <button
            className="mt-1 rounded border border-line py-1.5 text-xs text-tx2 transition-colors hover:border-acc hover:text-acc disabled:opacity-40"
            disabled={busy || !canSubmit}
            onClick={submit}
          >
            {busy ? "⠋ ..." : mode === "login" ? "⏎ login" : "⏎ register"}
          </button>

          {mode === "register" && (
            <div className="text-[10px] leading-relaxed text-tx3">
              // 账号与昵称由系统自动生成，登录后可在顶栏修改昵称
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-center gap-4">
        <button className="text-[11px] text-tx3 hover:text-acc" onClick={switchMode}>
          {mode === "login" ? "没有账号？→ register" : "已有账号？→ login"}
        </button>

        {showTheme && (
          <>
            <span className="text-line">|</span>
            {/* 主题切换：终端提示符 `~/theme` + 两态图标，不突兀 */}
            <button
              className="flex items-center gap-1.5 text-[11px] text-tx3 transition-colors hover:text-acc"
              onClick={toggleTheme}
              title={`当前 ${theme === "dark" ? "终端暗" : "纸面暖"}，点击切换`}
            >
              <span>{theme === "dark" ? "◐" : "◑"}</span>
              <span>{theme === "dark" ? "~/theme dark" : "~/theme warm"}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
