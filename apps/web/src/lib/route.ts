import { useEffect, useRef } from "react";
import { PANEL_IDS, usePanelStore, type PanelId } from "../stores/panel";
import { useChatStore } from "../stores/chat";
import { useUiStore } from "../stores/ui";

/**
 * Hash 路由：把"当前在哪个页面"投影到 URL，刷新后可还原。
 * 格式：#/p=mail,models&a=models&c=<convoId>&cli
 *  - p   打开的面板列表（逗号分隔，顺序 = tab 顺序）
 *  - a   激活的面板（等于首个时省略）
 *  - c   当前会话 id
 *  - cli CLI 覆盖层
 * 空状态为 #/（即首页）。
 */

export interface RouteState {
  panels: PanelId[];
  active: PanelId | null;
  chat: string | null;
  cli: boolean;
}

const isPanelId = (x: string): x is PanelId => (PANEL_IDS as readonly string[]).includes(x);

export function parseHash(hash: string): RouteState {
  const out: RouteState = { panels: [], active: null, chat: null, cli: false };
  const raw = hash.replace(/^#\/?/, "");
  if (!raw) return out;
  for (const part of raw.split("&")) {
    const eq = part.indexOf("=");
    const k = eq < 0 ? part : part.slice(0, eq);
    const v = eq < 0 ? "" : part.slice(eq + 1);
    if (k === "p" && v) out.panels = v.split(",").filter(isPanelId);
    else if (k === "a" && isPanelId(v)) out.active = v;
    else if (k === "c" && v) out.chat = v;
    else if (k === "cli") out.cli = true;
  }
  if (out.active && !out.panels.includes(out.active)) out.panels = [out.active, ...out.panels];
  if (!out.active && out.panels.length) out.active = out.panels[0];
  return out;
}

export function serializeHash(s: RouteState): string {
  const parts: string[] = [];
  if (s.panels.length) {
    parts.push(`p=${s.panels.join(",")}`);
    if (s.active && s.active !== s.panels[0]) parts.push(`a=${s.active}`);
  }
  if (s.chat) parts.push(`c=${s.chat}`);
  if (s.cli) parts.push("cli");
  return parts.length ? `#/${parts.join("&")}` : "#/";
}

/** 当前 stores 状态序列化为 hash（写路径与去重判断共用） */
function currentHash(): string {
  const p = usePanelStore.getState();
  const c = useChatStore.getState();
  const u = useUiStore.getState();
  return serializeHash({ panels: p.open, active: p.active, chat: c.currentId, cli: u.cliOpen });
}

/** hash → stores（读路径） */
function applyRoute(r: RouteState) {
  const p = usePanelStore.getState();
  if (r.panels.join() !== p.open.join() || r.active !== p.active) {
    usePanelStore.setState({ open: r.panels, active: r.active, fullscreen: false });
  }
  const u = useUiStore.getState();
  if (u.cliOpen !== r.cli) u.setCli(r.cli);
  const c = useChatStore.getState();
  if (r.chat !== c.currentId) {
    // 会话不存在等失败场景静默：保持现状，后续状态变化会自愈 URL
    if (r.chat) void c.openConversation(r.chat).catch(() => {});
    else c.newChat();
  }
}

/** 公开页 /p/:user、/t/:user 不参与 hash 路由 */
const isPublicPath = () => /^\/(p|t)\//.test(window.location.pathname);

/**
 * 双向同步 stores ↔ location.hash。
 * enabled = 已登录（公开页与登录屏不参与）。
 */
export function useHashRoute(enabled: boolean) {
  const hydrated = useRef(false);

  // 读路径：初始化还原 + 手动改 hash / 前进后退
  useEffect(() => {
    if (!enabled || isPublicPath()) return;
    if (!hydrated.current) {
      hydrated.current = true;
      applyRoute(parseHash(window.location.hash || "#/"));
    }
    const onChange = () => {
      const hash = window.location.hash || "#/";
      if (hash === currentHash()) return; // 自己写入的，跳过
      applyRoute(parseHash(hash));
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, [enabled]);

  // 写路径：stores 变化 → replaceState（不触发 hashchange，无循环）
  useEffect(() => {
    if (!enabled || isPublicPath()) return;
    const write = () => {
      const hash = currentHash();
      if ((window.location.hash || "#/") === hash) return;
      history.replaceState(
        null,
        "",
        hash === "#/" ? window.location.pathname + window.location.search : hash,
      );
    };
    const unsubs = [
      usePanelStore.subscribe(write),
      useChatStore.subscribe(write),
      useUiStore.subscribe(write),
    ];
    return () => unsubs.forEach((u) => u());
  }, [enabled]);
}
