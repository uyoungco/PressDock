import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSetAtom, useStore } from "jotai";
import { useIsMobile } from "@/hooks/use-mobile";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useBusinessQuery, useQueryUser } from "@/hooks/use-business-query";
import {
  businessKeys,
  channelFilterAtom,
  channelPositionsAtom,
  invalidateBusinessQueries,
} from "@/lib/query-runtime";
import { useChannelActions } from "./use-channel-actions";
import {
  channelService,
  channelQueryParams,
  readChannelQuery,
} from "./service";
import type { PromoteQuery, PromoteRecord, PromotePage } from "@/types/cms";
const queryKey = (query: PromoteQuery) => channelQueryParams(query).toString();
const sameFilters = (a: PromoteQuery, b: PromoteQuery) =>
  a.channel === b.channel &&
  a.subchannel === b.subchannel &&
  a.publishdate === b.publishdate &&
  a.pagesize === b.pagesize;
export function useChannelController() {
  const [params, setParams] = useSearchParams();
  const applied = useMemo(() => readChannelQuery(params), [params]);
  const key = queryKey(applied);
  const [draft, setDraft] = useState(applied);
  const user = useQueryUser();
  const client = useQueryClient();
  const store = useStore();
  const compact = useIsMobile();
  const remember = useSetAtom(channelFilterAtom);
  const groupQuery = useBusinessQuery(
    businessKeys.groups(user),
    channelService.groups,
  );
  const groups = groupQuery.data ?? [];
  const groupsLoading = groupQuery.isPending;
  const groupsError = groupQuery.error?.message ?? null;
  const list = useBusinessQuery(businessKeys.channelPage(user, applied), () =>
    channelService.list(applied),
  );
  const matchingResult = list.data ?? null;
  const loading = list.isPending;
  const error = list.error?.message ?? null;
  const previousResult = useRef<{
    query: PromoteQuery;
    page: PromotePage;
  } | null>(null);
  const [selected, setSelected] = useState<PromoteRecord | null>(null);
  const listViewport = useRef<HTMLDivElement>(null);
  const mutationRefresh = useRef<{ key: string; deleted: boolean } | null>(
    null,
  );
  const refresh = () => {
    void invalidateBusinessQueries(client, businessKeys.channels(user));
  };
  const actions = useChannelActions(
    applied,
    (deleted) => {
      mutationRefresh.current = { key, deleted };
    },
    {
      groups,
      loading: groupsLoading,
      error: groupsError,
      retry: () => {
        void groupQuery.refetch();
      },
    },
  );
  const locked = actions.sorting || actions.busy;
  const nextState = client.getQueryState<PromotePage>(
    businessKeys.channelPage(user, {
      ...applied,
      current: applied.current + 1,
    }),
  );
  const end =
    !!matchingResult &&
    (matchingResult.data.length < applied.pagesize ||
      (!!nextState?.data &&
        !nextState.isInvalidated &&
        nextState.dataUpdatedAt >= list.dataUpdatedAt &&
        !nextState.data.data.length));

  useEffect(() => {
    remember(applied);
    setDraft(applied);
    setSelected(null);
  }, [applied, remember]);
  useLayoutEffect(() => {
    const node = listViewport.current;
    if (!node || !matchingResult) return;
    const positionKey = `${user}:${key}`;
    node.scrollTop = store.get(channelPositionsAtom)[positionKey] ?? 0;
    const rememberPosition = () => {
      const positions = { ...store.get(channelPositionsAtom) };
      delete positions[positionKey];
      positions[positionKey] = node.scrollTop;
      store.set(
        channelPositionsAtom,
        Object.fromEntries(Object.entries(positions).slice(-30)),
      );
    };
    node.addEventListener("scroll", rememberPosition, { passive: true });
    return () => {
      rememberPosition();
      node.removeEventListener("scroll", rememberPosition);
    };
  }, [user, key, matchingResult, compact, store]);
  useEffect(() => {
    if (!list.data || list.isFetching || list.isError) return;
    const page = list.data;
    const mutation =
      mutationRefresh.current?.key === key ? mutationRefresh.current : null;
    mutationRefresh.current = null;
    if (mutation?.deleted && !page.data.length && applied.current > 1) {
      setParams(
        channelQueryParams({ ...applied, current: applied.current - 1 }),
        { replace: true },
      );
      return;
    }
    const previous = previousResult.current;
    if (
      !page.data.length &&
      previous &&
      sameFilters(applied, previous.query) &&
      applied.current === previous.query.current + 1
    ) {
      setParams(channelQueryParams(previous.query), { replace: true });
      toast.info("已到末页");
      return;
    }
    previousResult.current = { query: applied, page };
  }, [
    applied,
    key,
    list.data,
    list.dataUpdatedAt,
    list.isFetching,
    list.isError,
    setParams,
  ]);
  useEffect(() => {
    if (list.error && mutationRefresh.current?.key === key) {
      mutationRefresh.current = null;
      toast.warning("操作已完成，但列表刷新失败，请重试列表");
    }
  }, [list.error, key]);

  const subchannels =
    groups.find((group) => group.channel === draft.channel)?.subchannels ?? [];
  function submit(query: PromoteQuery) {
    if (locked) return;
    if (listViewport.current) listViewport.current.scrollTop = 0;
    store.set(channelPositionsAtom, {
      ...store.get(channelPositionsAtom),
      [`${user}:${queryKey(query)}`]: 0,
    });
    if (queryKey(query) === key) refresh();
    else setParams(channelQueryParams(query));
  }
  const sortReason =
    !applied.channel || !applied.subchannel || !applied.publishdate
      ? "请填写渠道、子渠道和日期并搜索后排序"
      : queryKey(draft) !== key
        ? "筛选条件尚未搜索，请先搜索"
        : list.isFetching || error || !matchingResult
          ? "请等待当前页成功加载"
          : matchingResult.data.length < 2
            ? "当前页至少需要两条素材"
            : "";
  return {
    applied,
    key,
    draft,
    setDraft,
    groups,
    groupsLoading,
    groupsError,
    list,
    groupQuery,
    matchingResult,
    loading,
    error,
    selected,
    setSelected,
    listViewport,
    refresh,
    actions,
    locked,
    end,
    subchannels,
    submit,
    sortReason,
  };
}
