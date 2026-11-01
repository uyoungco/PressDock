import { atom, createStore } from "jotai";
import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { queryClientAtom } from "jotai-tanstack-query";
import { globalSearchAtom } from "@/atoms/app";
import type { PromoteQuery } from "@/types/cms";
import type { ArticleView, CmsArticleQuery } from "@/types/cms-article";

export const channelFilterAtom = atom<PromoteQuery | null>(null);
export const articleFiltersAtom = atom<
  Partial<Record<ArticleView, CmsArticleQuery>>
>({});
export const harvestDateAtom = atom<{ date: string; today: string } | null>(
  null,
);
export const publishTabAtom = atom("pending");
export const harvestNotificationErrorAtom = atom<string | null>(null);
export const harvestNotificationsReadyAtom = atom(false);
export const businessQueriesEnabledAtom = atom(true);

export const businessKeys = {
  user: (user: number) => ["business", user] as const,
  channels: (user: number) => [...businessKeys.user(user), "channels"] as const,
  channelPage: (user: number, query: PromoteQuery) =>
    [...businessKeys.channels(user), query] as const,
  groups: (user: number) =>
    [...businessKeys.user(user), "channel-groups"] as const,
  articles: (user: number) =>
    [...businessKeys.user(user), "cms-articles"] as const,
  articlePage: (user: number, query: CmsArticleQuery) =>
    [...businessKeys.articles(user), query] as const,
  classes: (user: number) =>
    [...businessKeys.user(user), "article-classes"] as const,
  harvest: (user: number) => [...businessKeys.user(user), "harvest"] as const,
  harvestDate: (user: number, date: string) =>
    [...businessKeys.harvest(user), date] as const,
  localArticles: (user: number) =>
    [...businessKeys.user(user), "local-articles"] as const,
};

export function createQueryRuntime() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchInterval: false,
        retry: false,
      },
      mutations: { retry: false },
    },
  });
  const store = createStore();
  store.set(queryClientAtom, client);
  return { client, store, owner: null as number | null };
}
export type QueryRuntime = ReturnType<typeof createQueryRuntime>;
export const appQueryRuntime = createQueryRuntime();
const runtimes = new Set([appQueryRuntime]);
export function registerQueryRuntime(runtime: QueryRuntime) {
  runtimes.add(runtime);
  return () => {
    if (runtime !== appQueryRuntime) runtimes.delete(runtime);
  };
}
export function resetQueryRuntime(runtime: QueryRuntime) {
  refreshQueues.get(runtime.client)?.pending.clear();
  refreshQueues.delete(runtime.client);
  runtime.client.clear();
  runtime.store.set(businessQueriesEnabledAtom, true);
  runtime.store.set(channelFilterAtom, null);
  runtime.store.set(globalSearchAtom, "");
  runtime.store.set(articleFiltersAtom, {});
  runtime.store.set(harvestDateAtom, null);
  runtime.store.set(publishTabAtom, "pending");
  runtime.store.set(harvestNotificationErrorAtom, null);
  runtime.store.set(harvestNotificationsReadyAtom, false);
  runtime.owner = null;
}
export function retainQueryUser(user: number) {
  for (const runtime of runtimes) {
    if (runtime.owner !== null && runtime.owner !== user)
      resetQueryRuntime(runtime);
    runtime.owner = user;
    runtime.store.set(businessQueriesEnabledAtom, true);
  }
}
export function suspendBusinessQueries() {
  for (const runtime of runtimes) {
    runtime.store.set(businessQueriesEnabledAtom, false);
    void runtime.client.cancelQueries();
    void runtime.client.invalidateQueries({
      queryKey: ["business"],
      refetchType: "none",
    });
  }
}
export function clearBusinessQueries() {
  for (const runtime of runtimes) {
    resetQueryRuntime(runtime);
    runtime.store.set(businessQueriesEnabledAtom, false);
  }
}

// 连续事件和写入回调合并；请求期间的新通知在当前快照完成后补读，避免丢状态。
const refreshQueues = new WeakMap<
  QueryClient,
  { pending: Map<string, QueryKey>; task: Promise<void> }
>();
export function invalidateBusinessQueries(
  client: QueryClient,
  ...keys: QueryKey[]
) {
  let queue = refreshQueues.get(client);
  if (!queue) {
    queue = { pending: new Map(), task: Promise.resolve() };
    refreshQueues.set(client, queue);
    const current = queue;
    current.task = Promise.resolve().then(async () => {
      try {
        while (current.pending.size) {
          const batch = [...current.pending.values()];
          current.pending.clear();
          await Promise.all(
            batch.map((queryKey) =>
              client.invalidateQueries({ queryKey }, { cancelRefetch: false }),
            ),
          );
        }
      } finally {
        if (refreshQueues.get(client) === current) refreshQueues.delete(client);
      }
    });
  }
  for (const key of keys) queue.pending.set(JSON.stringify(key), key);
  return queue.task;
}
