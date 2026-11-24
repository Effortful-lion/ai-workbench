import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { useAuthStore } from "./stores/auth";
import { refreshSession } from "./lib/api";
import { useChatStore } from "./stores/chat";
import { usePanelStore } from "./stores/panel";
import { useUiStore } from "./stores/ui";
import TopBar from "./shell/TopBar";
import StatusBar from "./shell/StatusBar";
import HeroState from "./shell/HeroState";
import PanelZone from "./shell/PanelZone";
// 对话列带 react-markdown 全家桶，命令面板 / CLI 也不是首屏必需：按需加载
const ChatColumn = lazy(() => import("./shell/ChatColumn"));
const CommandPalette = lazy(() => import("./shell/CommandPalette"));
const CliOverlay = lazy(() => import("./shell/CliOverlay"));
import ConfirmDialog from "./shell/ConfirmDialog";
import ToastHost from "./shell/ToastHost";
// 公开只读页按需加载：首页不必带上 4 套公开页组件
const PublicResumePage = lazy(() => import("./features/resume/PublicResumePage"));
const PublicToolboxPage = lazy(() => import("./features/tools/PublicToolboxPage"));
const PublicContactPage = lazy(() => import("./features/contact/PublicContactPage"));
const PublicBlogPage = lazy(() => import("./features/blog/PublicBlogPage"));
import { useVisitorCollector } from "./lib/collector";
import { useHashRoute } from "./lib/route";

/** 懒加载占位：终端风，避免首帧白屏 */
function LazyFallback({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center font-mono text-[12px] text-tx3">
      ⠋ {label}
    </div>
  );
}

function ChatPane() {
  return (
    <Suspense fallback={<LazyFallback label="正在载入对话…" />}>
      <ChatColumn />
    </Suspense>
  );
}

/** 公开页懒加载占位 */
function PublicPage({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<LazyFallback label="正在载入页面…" />}>
      {children}
    </Suspense>
  );
}

export default function App() {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const { theme, cliOpen, paletteOpen, setPalette, mobileView, setMobileView } = useUiStore();
  const panelCount = usePanelStore((s) => s.open.length);
  const fullscreen = usePanelStore((s) => s.fullscreen);
  const currentId = useChatStore((s) => s.currentId);
  const pendingNew = useChatStore((s) => s.pendingNew);
  const connect = useChatStore((s) => s.connect);
  // 刷新页面后 accessToken 只在内存里，先静默换票再渲染，避免首屏一堆 401
  const [booting, setBooting] = useState(() => Boolean(useAuthStore.getState().user));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const { user: cached, accessToken: token } = useAuthStore.getState();
    if (!cached || token) {
      setBooting(false);
      return;
    }
    let alive = true;
    void refreshSession().then((ok) => {
      if (!alive) return;
      if (!ok) useAuthStore.getState().clear();
      setBooting(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    // 有用户且拿到票据后再连 Socket（握手要用 accessToken）
    if (user && accessToken) connect();
  }, [user, accessToken, connect]);

  // 浏览器「后退」命中 bfcache 时页面不会重新初始化，内存里的 store 还是离开前的旧值：
  // 登录后在公开页返回首页却显示成游客就是这个原因。恢复时按 localStorage 重新水合并续票。
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      void Promise.resolve(useAuthStore.persist.rehydrate()).then(() => {
        const { user: restored, accessToken: token } = useAuthStore.getState();
        if (restored && !token) void refreshSession();
      });
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // 移动端：打开面板自动切到面板视图，全部关闭回到对话视图（桌面端始终同屏，忽略此状态）
  useEffect(() => {
    setMobileView(panelCount > 0 ? "panel" : "chat");
  }, [panelCount, setMobileView]);

  // ⌘K 全局唤起
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // 游客没有命令面板（面板与命令都要求登录）
      if (!useAuthStore.getState().user) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(!useUiStore.getState().paletteOpen);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [setPalette]);

  // 访问采集（登录后才启用）
  useVisitorCollector();

  // hash 路由：刷新后还原面板 / 会话 / CLI 状态
  useHashRoute(!!user);

  // 公开页 /p/:username（简历）、/t/:username（百宝箱）、/c/:username（联系我）、/b/:username(/:slug)（博客）：游客无需登录，只读
  const decoded = (raw: string | undefined) => {
    if (!raw) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };
  const publicResume = decoded(window.location.pathname.match(/^\/p\/([^/]+)\/?$/)?.[1]);
  if (publicResume)
    return (
      <PublicPage>
        <PublicResumePage username={publicResume} />
      </PublicPage>
    );
  const publicToolbox = decoded(window.location.pathname.match(/^\/t\/([^/]+)\/?$/)?.[1]);
  if (publicToolbox)
    return (
      <PublicPage>
        <PublicToolboxPage username={publicToolbox} />
      </PublicPage>
    );
  const publicContact = decoded(window.location.pathname.match(/^\/c\/([^/]+)\/?$/)?.[1]);
  if (publicContact)
    return (
      <PublicPage>
        <PublicContactPage username={publicContact} />
      </PublicPage>
    );
  const blogMatch = window.location.pathname.match(/^\/b\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (blogMatch) {
    const blogUser = decoded(blogMatch[1]);
    const blogSlug = decoded(blogMatch[2]);
    if (blogUser)
      return (
        <PublicPage>
          <PublicBlogPage username={blogUser} slug={blogSlug ?? undefined} />
        </PublicPage>
      );
  }

  // 换票期间不渲染登录页，否则会闪一下「请登录」
  if (booting) {
    return (
      <div className="grid-bg flex h-full items-center justify-center font-mono text-[12px] text-tx3">
        ▸ 正在恢复会话…
      </div>
    );
  }

  // 游客：直接进首页（只读形态）。AI 对话 / 面板 / 命令等受限入口点击时弹登录浮层
  if (!user) {
    return (
      <div className="grid-bg flex h-full flex-col">
        <TopBar />
        <main className="min-h-0 flex-1">
          <HeroState />
        </main>
        <StatusBar mode="A" />
        <ToastHost />
      </div>
    );
  }

  // 三态：C 沉浸（CLI 覆盖） / B 工作（对话列+面板） / A 对话（首页 hero）
  const mode = cliOpen ? "C" : currentId || pendingNew || panelCount > 0 ? "B" : "A";

  return (
    <div className="grid-bg flex h-full flex-col">
      <TopBar />
      <main className="min-h-0 flex-1">
        {mode === "C" ? (
          <Suspense fallback={<LazyFallback label="正在载入终端…" />}>
            <CliOverlay />
          </Suspense>
        ) : mode === "A" ? (
          <HeroState />
        ) : (
          <div className="flex h-full">
            {/* 桌面端：聊天栏固定 400px 与面板同屏；移动端（<lg）：聊天/面板互斥全屏，由 mobileView 决定
                面板全屏：对话栏整体不渲染（仅收起对话，TopBar 保留），退出后恢复双栏 */}
            {panelCount === 0 ? (
              <div className="min-w-0 flex-1">
                <ChatPane />
              </div>
            ) : (
              !fullscreen && (
                <div
                  className={`${mobileView === "chat" ? "flex" : "hidden"} w-full flex-col border-line lg:flex lg:w-[400px] lg:flex-none lg:border-r`}
                >
                  <ChatPane />
                </div>
              )
            )}
            {panelCount > 0 && (
              <div className={`${fullscreen || mobileView === "panel" ? "flex" : "hidden"} min-w-0 flex-1 flex-col lg:flex`}>
                <PanelZone />
              </div>
            )}
            {/* 移动端浮动切换按钮：聊天 ⇄ 面板（全屏时对话栏已收起，不显示） */}
            {panelCount > 0 && !fullscreen && (
              <button
                className="fixed bottom-14 right-4 z-40 flex h-10 items-center gap-1.5 rounded-full border border-acc/60 bg-bg1 px-3.5 font-mono text-[11px] text-acc shadow-[0_4px_16px_rgba(0,0,0,0.45)] lg:hidden"
                onClick={() => setMobileView(mobileView === "chat" ? "panel" : "chat")}
                title={mobileView === "chat" ? "查看面板" : "回到对话"}
              >
                {mobileView === "chat" ? "▤ 面板" : "✉ 对话"}
              </button>
            )}
          </div>
        )}
      </main>
      <StatusBar mode={mode} />
      {/* 全局二次确认弹窗（退出登录/删除等，替代 window.confirm） */}
      <ConfirmDialog />
      {/* ⌘K 才挂载：命令面板模块不必随首屏下载 */}
      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      )}
      <ToastHost />
    </div>
  );
}
