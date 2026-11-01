import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { atomWithQuery } from "jotai-tanstack-query";
import { type QueryKey } from "@tanstack/react-query";
import { useAuth } from "./use-auth";
import { businessQueriesEnabledAtom } from "@/lib/query-runtime";

export function useQueryUser() {
  return useAuth().session?.user.userId ?? 0;
}

export function useBusinessQuery<T>(
  key: QueryKey,
  load: () => Promise<T>,
  enabled = true,
) {
  const identity = JSON.stringify(key);
  // key 的规范化值决定查询；捕获同一 key 的业务函数不随组件重绘重建 observer。
  const query = useMemo(
    () =>
      atomWithQuery((get) => ({
        queryKey: key,
        queryFn: load,
        enabled: enabled && get(businessQueriesEnabledAtom),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [identity, enabled],
  );
  return useAtomValue(query);
}
