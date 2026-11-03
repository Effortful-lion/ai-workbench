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
import ToastHost from "./shell/ToastHost";
import PublicResumePage from "./features/resume/PublicResumePage";
import PublicToolboxPage from "./features/tools/PublicToolboxPage";
import { useVisitorCollector } from "./lib/collector";
import { useHashRoute } from "./lib/route";

export default function App() {
  const user = useAuthStore((s) => s.user);
  const { theme, cliOpen, setPalette } = useUiStore();
  const panelCount = usePanelStore((s) => s.open.length);
  const currentId = useChatStore((s) => s.currentId);
  const pendingNew = useChatStore((s) => s.pendingNew);
  const connect = useChatStore((s) => s.connect);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (user) connect();
  }, [user, connect]);

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

  // 公开页 /p/:username（简历）与 /t/:username（百宝箱）：游客无需登录，只读
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
            <div className={panelCount > 0 ? "w-[400px] flex-none border-r border-line" : "min-w-0 flex-1"}>
              <ChatColumn />
            </div>
            {panelCount > 0 && <PanelZone />}
          </div>
        )}
      </main>
      <StatusBar mode={mode} />
      <CommandPalette />
      <ToastHost />
    </div>
  );
}
