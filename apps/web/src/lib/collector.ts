import { useEffect, useRef } from "react";
import { useAuthStore } from "../stores/auth";
import { usePanelStore } from "../stores/panel";

const SESSION_KEY = "aiwb-session-id";
const BATCH_KEY = "aiwb-stats-batch";

type BatchRow = { sessionId: string; userId?: string | null; path: string; refUrl?: string | null; durationMs: number };

/**
 * 生成 / 恢复匿名 sessionId（localStorage 持久，不跨设备）
 * 口径：同一 sessionId 算同一 UV（跨日仍同）
 */
function getSessionId(): string {
  let sid = localStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = "s_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

/**
 * 全局访问采集 hook：挂载在 App.tsx 里
 * - 每次 panel 切换 / mode 变化 = 1 次 page_view
 * - 离开 / 切标签页 / 退出时 flush
 * - 批量（最多 20 条或 5s）上报
 */
export function useVisitorCollector() {
  const { user } = useAuthStore();
  const batchRef = useRef<BatchRow[]>([]);
  const currentPageRef = useRef<string>("");
  const pageStartRef = useRef<number>(Date.now());

  // 初始化 sessionId
  useEffect(() => {
    getSessionId();
  }, []);

  // 从 localStorage 恢复未 flush 的 batch
  useEffect(() => {
    try {
      const raw = localStorage.getItem(BATCH_KEY);
      if (raw) batchRef.current = JSON.parse(raw);
    } catch { /* ignore */ }
  }, []);

  // 当前页面变化：计算上一页停留时长，入 batch
  const enterPage = (newPath: string) => {
    const now = Date.now();
    const sid = getSessionId();
    const uid = useAuthStore.getState().user?.id ?? null;

    // 上一页：计算停留时长
    if (currentPageRef.current && currentPageRef.current !== newPath) {
      const durationMs = now - pageStartRef.current;
      batchRef.current.push({
        sessionId: sid,
        userId: uid,
        path: currentPageRef.current,
        refUrl: null,
        durationMs,
      });
    }

    currentPageRef.current = newPath;
    pageStartRef.current = now;
  };

  const flush = async () => {
    if (batchRef.current.length === 0) return;
    const rows = [...batchRef.current];
    batchRef.current = [];
    localStorage.removeItem(BATCH_KEY);
    try {
      await fetch("/api/stats/collect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(rows),
        keepalive: true,
      });
    } catch {
      // 写入 localStorage 下次再发
      try { localStorage.setItem(BATCH_KEY, JSON.stringify(batchRef.current)); } catch { /* ignore */ }
    }
  };

  // 挂载 + 监听 panel 变化
  useEffect(() => {
    // 初始页面
    enterPage("/");

    // 订阅 panelStore 变化（注意：subscribe 必须在 store 函数上调，不是 hook 返回值）
    const unsub = usePanelStore.subscribe((state, prev) => {
      if (state.active !== prev.active || state.open.length !== prev.open.length) {
        const path = state.active ? "/" + state.active : "/";
        enterPage(path);
      }
    });

    // visibilitychange（切后台 / 关闭标签页）
    const onVisChange = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const onBeforeUnload = () => void flush();

    document.addEventListener("visibilitychange", onVisChange);
    window.addEventListener("beforeunload", onBeforeUnload);

    // 30s 心跳 flush
    const heartbeat = setInterval(flush, 30_000);

    // 退出时 flush 最后一页
    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onVisChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
      clearInterval(heartbeat);
      // 组件卸载也 flush
      const sid = getSessionId();
      const durationMs = Date.now() - pageStartRef.current;
      if (currentPageRef.current && durationMs > 500) {
        batchRef.current.push({ sessionId: sid, path: currentPageRef.current, refUrl: null, durationMs });
      }
      void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // user 登录/登出也触发一次（登录即新会话）
  useEffect(() => {
    if (user) enterPage("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
}

/** 终端风格 bar chart：■ = 完整块，□ = 半块 */
export function asciiBar(value: number, max: number, width = 20): string {
  if (max <= 0) return "".padEnd(width);
  const filled = Math.round((value / max) * width);
  return "■".repeat(Math.max(0, filled)) + "□".repeat(Math.max(0, width - filled));
}
