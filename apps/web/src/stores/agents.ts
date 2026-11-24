import { create } from "zustand";
import type { AgentDto, ToolSchemaDto, UpsertAgentInput } from "@aiwb/shared";
import { api } from "../lib/api";
import { useAuthStore } from "./auth";

interface AgentsState {
  agents: AgentDto[];
  /** 当前角色可用的工具 Schema（创建 Agent 时勾选） */
  toolSchemas: ToolSchemaDto[];
  /** 已加载数据归属的用户，换账号后自动重新加载，避免串数据 */
  loadedFor: string | null;
  /** force=true 用于写操作后强制刷新；平时重复挂载直接复用已加载数据 */
  load: (force?: boolean) => Promise<void>;
  create: (input: UpsertAgentInput) => Promise<void>;
  update: (id: string, input: Partial<UpsertAgentInput>) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useAgentsStore = create<AgentsState>()((set, get) => ({
  agents: [],
  toolSchemas: [],
  loadedFor: null,

  load: async (force = false) => {
    const uid = useAuthStore.getState().user?.id ?? "";
    // 切面板会反复挂载 ChatColumn / AgentsPanel，同一用户已加载过就不重复打接口
    if (!force && get().loadedFor === uid) return;
    // 请求前先占位：React StrictMode 会双跑 effect，避免两次并发都发请求
    set({ loadedFor: uid });
    try {
      const [agents, toolSchemas] = await Promise.all([
        api<AgentDto[]>("/agents"),
        api<ToolSchemaDto[]>("/tools"),
      ]);
      set({ agents, toolSchemas, loadedFor: uid });
    } catch {
      set({ loadedFor: uid });
    }
  },

  create: async (input) => {
    await api("/agents", { method: "POST", body: JSON.stringify(input) });
    await get().load(true);
  },

  update: async (id, input) => {
    await api(`/agents/${id}`, { method: "PATCH", body: JSON.stringify(input) });
    await get().load(true);
  },

  remove: async (id) => {
    await api(`/agents/${id}`, { method: "DELETE" });
    await get().load(true);
  },
}));
