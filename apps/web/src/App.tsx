import { useEffect } from "react";
import { useAuthStore } from "./stores/auth";
import { useChatStore } from "./stores/chat";
import { usePanelStore } from "./stores/panel";
import { useUiStore } from "./stores/ui";
import LoginScreen from "./features/auth/LoginScreen";
import TopBar from "./shell/TopBar";
import StatusBar from "./shell/StatusBar";
import HeroState from "./shell/HeroState";
import ChatColumn from "./shell/ChatColumn";
import PanelZone from "./shell/PanelZone";
import CommandPalette from "./shell/CommandPalette";
import CliOverlay from "./shell/CliOverlay";
import ConfirmDialog from "./shell/ConfirmDialog";
import ToastHost from "./shell/ToastHost";
import PublicResumePage from "./features/resume/PublicResumePage";
import PublicToolboxPage from "./features/tools/PublicToolboxPage";
import PublicContactPage from "./features/contact/PublicContactPage";
import PublicBlogPage from "./features/blog/PublicBlogPage";
import { useVisitorCollector } from "./lib/collector";
import { useHashRoute } from "./lib/route";

export default function App() {
  const user = useAuthStore((s) => s.user);
  const { theme, cliOpen, setPalette, mobileView, setMobileView } = useUiStore();
  const panelCount = usePanelStore((s) => s.open.length);
  const fullscreen = usePanelStore((s) => s.fullscreen);
  const currentId = useChatStore((s) => s.currentId);
  const pendingNew = useChatStore((s) => s.pendingNew);
  const connect = useChatStore((s) => s.connect);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (user) connect();
  }, [user, connect]);

  // 移动端：打开面板自动切到面板视图，全部关闭回到对话视图（桌面端始终同屏，忽略此状态）
  useEffect(() => {
    setMobileView(panelCount > 0 ? "panel" : "chat");
  }, [panelCount, setMobileView]);

  // ⌘K 全局唤起
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
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
  if (publicResume) return <PublicResumePage username={publicResume} />;
  const publicToolbox = decoded(window.location.pathname.match(/^\/t\/([^/]+)\/?$/)?.[1]);
  if (publicToolbox) return <PublicToolboxPage username={publicToolbox} />;
  const publicContact = decoded(window.location.pathname.match(/^\/c\/([^/]+)\/?$/)?.[1]);
  if (publicContact) return <PublicContactPage username={publicContact} />;
  const blogMatch = window.location.pathname.match(/^\/b\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (blogMatch) {
    const blogUser = decoded(blogMatch[1]);
    const blogSlug = decoded(blogMatch[2]);
    if (blogUser) return <PublicBlogPage username={blogUser} slug={blogSlug ?? undefined} />;
  }

  if (!user) return <LoginScreen />;

  // 三态：C 沉浸（CLI 覆盖） / B 工作（对话列+面板） / A 对话（首页 hero）
  const mode = cliOpen ? "C" : currentId || pendingNew || panelCount > 0 ? "B" : "A";

  return (
    <div className="grid-bg flex h-full flex-col">
      <TopBar />
      <main className="min-h-0 flex-1">
        {mode === "C" ? (
          <CliOverlay />
        ) : mode === "A" ? (
          <HeroState />
        ) : (
          <div className="flex h-full">
            {/* 桌面端：聊天栏固定 400px 与面板同屏；移动端（<lg）：聊天/面板互斥全屏，由 mobileView 决定
                面板全屏：只收起对话栏，保留顶部 header */}
            <div
              className={
                panelCount > 0
                  ? `${fullscreen ? "hidden" : mobileView === "chat" ? "flex" : "hidden"} w-full flex-col border-line lg:flex lg:w-[400px] lg:flex-none lg:border-r`
                  : "min-w-0 flex-1"
              }
            >
              <ChatColumn />
            </div>
            {panelCount > 0 && (
              <div className={`${mobileView === "panel" ? "flex" : "hidden"} min-w-0 flex-1 flex-col lg:flex`}>
                <PanelZone />
              </div>
            )}
            {/* 移动端浮动切换按钮：聊天 ⇄ 面板 */}
            {panelCount > 0 && (
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
      <CommandPalette />
      <ToastHost />
    </div>
  );
}
