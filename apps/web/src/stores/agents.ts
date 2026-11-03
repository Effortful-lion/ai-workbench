import { create } from "zustand";
import type { AgentDto, ToolSchemaDto, UpsertAgentInput } from "@aiwb/shared";
import { api } from "../lib/api";

interface AgentsState {
  agents: AgentDto[];
  /** 当前角色可用的工具 Schema（创建 Agent 时勾选） */
  toolSchemas: ToolSchemaDto[];
  loaded: boolean;
  load: () => Promise<void>;
  create: (input: UpsertAgentInput) => Promise<void>;
  update: (id: string, input: Partial<UpsertAgentInput>) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useAgentsStore = create<AgentsState>()((set, get) => ({
  agents: [],
  toolSchemas: [],
  loaded: false,

  load: async () => {
    try {
      const [agents, toolSchemas] = await Promise.all([
        api<AgentDto[]>("/agents"),
        api<ToolSchemaDto[]>("/tools"),
      ]);
      set({ agents, toolSchemas, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  create: async (input) => {
    await api("/agents", { method: "POST", body: JSON.stringify(input) });
    await get().load();
  },

  update: async (id, input) => {
    await api(`/agents/${id}`, { method: "PATCH", body: JSON.stringify(input) });
    await get().load();
  },

  remove: async (id) => {
    await api(`/agents/${id}`, { method: "DELETE" });
    await get().load();
  },
}));
