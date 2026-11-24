import { QueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../stores/auth";

/**
 * 全站请求缓存：面板只渲染当前激活项，切走会卸载，
 * 有了 staleTime 后 30s 内切回直接使用缓存（不再闪 loading、不再重复打接口）。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /** 30s 内视为新鲜，不重复请求；后台仍会在窗口聚焦/重连时校准 */
      staleTime: 30_000,
      /** 未挂载的查询保留 5 分钟 */
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
});

/** 换账号 / 退出登录立刻清空缓存：私有数据不能留给下一位用户 */
let lastUserId = useAuthStore.getState().user?.id ?? null;
useAuthStore.subscribe((s) => {
  const id = s.user?.id ?? null;
  if (id !== lastUserId) {
    lastUserId = id;
    void queryClient.clear();
  }
});

/** 统一 query key：写操作按 key 失效，避免全量 clear */
export const QK = {
  models: ["models"] as const,
  blogPosts: ["blog", "posts"] as const,
  blogComments: (postId: string) => ["blog", "comments", postId] as const,
  blogModeration: (status: string) => ["blog", "moderation", status] as const,
  notifyDigest: ["notify", "digest"] as const,
  notifyList: ["notify", "list"] as const,
  resume: ["resume", "me"] as const,
  toolbox: ["toolbox", "items"] as const,
  // 工具管理 / 执行记录
  tools: ["tools"] as const,
  customTools: ["tools", "custom"] as const,
  executions: ["agents", "executions"] as const,
  latestTrace: (conversationId: string) => ["agents", "trace", conversationId] as const,
  stats: (days: number) => ["stats", "overview", days] as const,
  // 工作台面板：同一面板的多个 GET 合并成一个 query，写操作整体失效
  schedule: ["schedule", "tasks"] as const,
  projects: ["projects"] as const,
  projectDocs: (id: string) => ["projects", "docs", id] as const,
  codeRepos: ["code", "repos"] as const,
  codeFiles: (id: string) => ["code", "files", id] as const,
  commerce: ["commerce"] as const,
  crm: ["crm"] as const,
  crmCustomer: (id: string) => ["crm", "customer", id] as const,
  kb: ["kb"] as const,
  kbTree: ["kb", "folders"] as const,
  mailSummary: ["mail", "summary"] as const,
  mailMessages: (folder: string) => ["mail", "messages", folder] as const,
  mailDigest: ["mail", "digest"] as const,
  ghAccount: ["github", "account"] as const,
  ghProfile: ["github", "profile"] as const,
  ghRepos: (q: string) => ["github", "repos", q] as const,
  ghOverview: ["github", "overview"] as const,
  ghInbox: ["github", "inbox"] as const,
  ghActivity: ["github", "activity"] as const,
  contact: ["profile", "contact"] as const,
};

/** 写操作后失效并后台重取；可一次传多个 key */
export function invalidate(...keys: readonly (readonly unknown[])[]) {
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}
