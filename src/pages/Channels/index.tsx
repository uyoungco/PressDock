import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Copy, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MaterialImage } from "@/features/channels/MaterialImage";
import { channelQueryMemory } from "@/features/channels/query-memory";
import { MaterialTable } from "@/features/channels/MaterialTable";
import { useChannelActions } from "@/features/channels/use-channel-actions";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  channelService,
  channelQueryParams,
  readChannelQuery,
} from "@/features/channels/service";
import {
  pageSizes,
  type ChannelGroup,
  type PromotePage,
  type PromoteQuery,
  type PromoteRecord,
  type PromoteField,
} from "@/types/cms";

const selectClass =
  "h-7 min-w-0 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50 max-md:min-h-11";
const show = (value: string | number | null) =>
  value === "" || value === null ? "—" : String(value);
const queryKey = (query: PromoteQuery) => channelQueryParams(query).toString();
const sameFilters = (a: PromoteQuery, b: PromoteQuery) =>
  a.channel === b.channel &&
  a.subchannel === b.subchannel &&
  a.publishdate === b.publishdate &&
  a.pagesize === b.pagesize;

function MaterialDetail({
  row,
  onClose,
}: {
  row: PromoteRecord | null;
  onClose: () => void;
}) {
  const fields: [PromoteField, string][] = [
    ["id", "素材 ID"],
    ["articleId", "文章 ID"],
    ["title", "标题"],
    ["channel", "渠道"],
    ["subChannel", "子渠道"],
    ["writer", "作者"],
    ["publishDate", "发布日期"],
    ["order", "排序值"],
    ["smallText", "摘要"],
    ["host", "Host"],
    ["url", "文章链接"],
    ["landUrl", "落地链接"],
    ["titlePic", "图片地址"],
    ["titlePic2", "第二张图片地址"],
    ["createdAt", "创建时间"],
    ["updatedAt", "更新时间"],
    ["deletedAt", "删除时间"],
  ];
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("已复制");
    } catch {
      toast.error("复制失败，请手动选择文本复制");
    }
  }
  return (
    <Dialog
      open={!!row}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
        <DialogTitle>素材详情</DialogTitle>
        <DialogDescription>
          查看渠道素材的标题、摘要和关联信息。
        </DialogDescription>
        {row && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <MaterialImage
                key={`first-${row.id}`}
                url={row.titlePic}
                label="主图"
              />
              <MaterialImage
                key={`second-${row.id}`}
                url={row.titlePic2}
                label="第二张图片"
              />
            </div>
            <dl className="divide-y text-sm">
              {fields.map(([field, label]) => (
                <div
                  key={field}
                  className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 py-3"
                >
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 whitespace-pre-wrap break-all">
                    {show(row[field])}
                    {["url", "landUrl", "titlePic", "titlePic2"].includes(
                      field,
                    ) &&
                      row[field] && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`复制${label}`}
                          onClick={() => void copy(String(row[field]))}
                        >
                          <Copy className="size-3.5" />
                        </Button>
                      )}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Channels() {
  const [params] = useSearchParams();
  const remembered = channelQueryMemory.read();
  if (!params.size) {
    return (
      <Navigate
        replace
        to={{
          pathname: "/channels",
          search: `?${channelQueryParams(remembered ?? readChannelQuery(params))}`,
        }}
      />
    );
  }
  return <ChannelResults />;
}

function ChannelResults() {
  const [params, setParams] = useSearchParams();
  const applied = useMemo(() => readChannelQuery(params), [params]);
  const key = queryKey(applied);
  const [draft, setDraft] = useState(applied);
  const [groups, setGroups] = useState<ChannelGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [groupsRetry, setGroupsRetry] = useState(0);
  const [result, setResult] = useState<{
    query: PromoteQuery;
    page: PromotePage;
  } | null>(null);
  const previousResult = useRef<typeof result>(null);
  const rollback = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [end, setEnd] = useState(false);
  const [selected, setSelected] = useState<PromoteRecord | null>(null);
  const listViewport = useRef<HTMLDivElement>(null);
  const resetScroll = useRef(true);
  const lastSuccessfulQuery = useRef<string | null>(null);
  const mutationRefresh = useRef<{ key: string; deleted: boolean } | null>(
    null,
  );
  const actions = useChannelActions(applied, (deleted) => {
    mutationRefresh.current = { key, deleted };
    setRetry((v) => v + 1);
  });
  const locked = actions.sorting || actions.busy;

  useEffect(() => {
    channelQueryMemory.remember(applied);
    setDraft(applied);
  }, [applied]);
  useEffect(() => {
    let active = true;
    setGroupsLoading(true);
    setGroupsError(null);
    channelService
      .groups()
      .then((value) => {
        if (active) setGroups(value);
      })
      .catch((reason: unknown) => {
        if (active)
          setGroupsError(
            reason instanceof Error ? reason.message : "读取渠道配置失败",
          );
      })
      .finally(() => {
        if (active) setGroupsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [groupsRetry]);
  useEffect(() => {
    if (rollback.current === key) {
      rollback.current = null;
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    setSelected(null);
    channelService
      .list(applied)
      .then((page) => {
        if (!active) return;
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
          setEnd(true);
          rollback.current = queryKey(previous.query);
          setParams(channelQueryParams(previous.query), { replace: true });
          toast.info("已到末页");
          return;
        }
        const value = { query: applied, page };
        if (resetScroll.current || lastSuccessfulQuery.current !== key) {
          if (listViewport.current) listViewport.current.scrollTop = 0;
          resetScroll.current = false;
        }
        lastSuccessfulQuery.current = key;
        previousResult.current = value;
        setResult(value);
        setEnd(page.data.length < applied.pagesize);
      })
      .catch((reason: unknown) => {
        if (active) {
          if (mutationRefresh.current?.key === key) {
            toast.warning("操作已完成，但列表刷新失败，请重试列表");
            mutationRefresh.current = null;
          }
          setError(reason instanceof Error ? reason.message : "读取素材失败");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applied, key, retry, setParams]);

  const subchannels =
    groups.find((group) => group.channel === draft.channel)?.subchannels ?? [];
  const matchingResult =
    result && queryKey(result.query) === key ? result.page : null;
  function submit(query: PromoteQuery) {
    if (locked) return;
    resetScroll.current = true;
    if (queryKey(query) === key) setRetry((value) => value + 1);
    else setParams(channelQueryParams(query));
  }
  const sortReason =
    !applied.channel || !applied.subchannel || !applied.publishdate
      ? "请填写渠道、子渠道和日期并搜索后排序"
      : queryKey(draft) !== key
        ? "筛选条件尚未搜索，请先搜索"
        : loading || error || !matchingResult
          ? "请等待当前页成功加载"
          : matchingResult.data.length < 2
            ? "当前页至少需要两条素材"
            : "";
  return (
    <>
      <Card className="h-full min-h-0 min-w-0 flex-1 gap-0 overflow-hidden py-0 shadow-none">
        <form
          aria-label="渠道素材筛选"
          className="grid shrink-0 grid-cols-2 items-end gap-x-3 gap-y-2 border-b px-3 py-2 md:flex md:flex-wrap md:px-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit({ ...draft, current: 1, pagesize: applied.pagesize });
          }}
        >
          <fieldset disabled={locked} className="contents">
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground md:min-w-36">
              渠道
              <select
                aria-label="渠道"
                className={selectClass}
                value={draft.channel}
                disabled={groupsLoading || !!groupsError}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    channel: event.target.value,
                    subchannel: "",
                  })
                }
              >
                <option value="">全部渠道</option>
                {draft.channel &&
                  !groups.some((group) => group.channel === draft.channel) && (
                    <option value={draft.channel}>{draft.channel}</option>
                  )}
                {groups.map((group) => (
                  <option key={group.channel} value={group.channel}>
                    {group.channel}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground md:min-w-48">
              子渠道
              <select
                aria-label="子渠道"
                className={`${selectClass} max-w-80`}
                value={draft.subchannel}
                disabled={!draft.channel || groupsLoading || !!groupsError}
                onChange={(event) =>
                  setDraft({ ...draft, subchannel: event.target.value })
                }
              >
                <option value="">全部子渠道</option>
                {draft.subchannel &&
                  !subchannels.includes(draft.subchannel) && (
                    <option value={draft.subchannel}>{draft.subchannel}</option>
                  )}
                {subchannels.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              发布日期
              <Input
                aria-label="发布日期"
                type="date"
                value={draft.publishdate}
                onChange={(event) =>
                  setDraft({ ...draft, publishdate: event.target.value })
                }
                className="h-7 w-full min-w-0 md:w-40"
              />
            </label>
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm">
                <Search className="size-4" />
                搜索
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const query = {
                    channel: "",
                    subchannel: "",
                    publishdate: "",
                    current: 1,
                    pagesize: applied.pagesize,
                  };
                  setDraft(query);
                  submit(query);
                }}
              >
                <RotateCcw className="size-4" />
                重置
              </Button>
            </div>
          </fieldset>
        </form>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 md:gap-3 md:px-4">
          <Button size="sm" disabled={locked} onClick={actions.create}>
            新增
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={actions.busy || (!actions.sorting && !!sortReason)}
            onClick={() =>
              actions.sorting
                ? void actions.saveOrder()
                : matchingResult && actions.startSort(matchingResult.data)
            }
          >
            {actions.busy && actions.sorting
              ? "正在保存排序…"
              : actions.sorting
                ? "保存排序"
                : "开始排序"}
          </Button>
          {actions.sorting ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={actions.busy}
                onClick={actions.cancelSort}
              >
                取消排序
              </Button>
              <span className="min-w-0 text-xs text-muted-foreground max-sm:basis-full">
                仅当前页，排序值从 1 开始；拖动手柄或使用上移、下移按钮。
              </span>
            </>
          ) : (
            sortReason && (
              <span className="min-w-0 text-xs text-muted-foreground max-sm:basis-full">
                {sortReason}
              </span>
            )
          )}
        </div>
        <div
          ref={listViewport}
          role="region"
          aria-label="渠道素材内容"
          tabIndex={0}
          className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain [scrollbar-gutter:stable] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          {groupsLoading && (
            <p
              role="status"
              className="border-b px-4 py-2 text-xs text-muted-foreground"
            >
              正在加载渠道选项…
            </p>
          )}
          {groupsError && (
            <div
              role="alert"
              className="flex items-center gap-3 border-b p-4 text-sm text-destructive"
            >
              渠道选项加载失败：{groupsError}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setGroupsRetry((v) => v + 1)}
              >
                重试渠道选项
              </Button>
            </div>
          )}
          {loading ? (
            <div aria-label="正在加载素材" className="space-y-3 p-4">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : error ? (
            <div role="alert" className="space-y-3 p-6 text-sm">
              <p className="text-destructive">{error}</p>
              <Button variant="outline" onClick={() => setRetry((v) => v + 1)}>
                重试素材列表
              </Button>
            </div>
          ) : (
            matchingResult &&
            (matchingResult.data.length ? (
              <MaterialTable
                rows={actions.sorted ?? matchingResult.data}
                sorting={actions.sorting}
                busy={actions.busy}
                onMove={actions.move}
                onDetail={setSelected}
                onEdit={(row) => void actions.beginEdit(row)}
                onDelete={actions.requestDelete}
              />
            ) : (
              <p className="py-16 text-center text-sm text-muted-foreground">
                暂无符合条件的素材
              </p>
            ))
          )}
        </div>
        <div
          aria-label="素材分页"
          className="flex shrink-0 flex-col gap-2 border-t px-3 py-2 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 md:px-4"
        >
          <span>
            第 {applied.current} 页
            {matchingResult &&
              !(
                applied.publishdate &&
                !applied.channel &&
                !applied.subchannel
              ) &&
              ` · 服务端参考总数 ${matchingResult.total}`}
          </span>
          <div className="flex flex-wrap items-center justify-between gap-2 sm:ml-auto sm:gap-3">
            <label className="flex items-center gap-2">
              每页条数
              <select
                aria-label="每页条数"
                disabled={locked}
                className={selectClass}
                value={applied.pagesize}
                onChange={(event) =>
                  submit({
                    ...applied,
                    current: 1,
                    pagesize: Number(
                      event.target.value,
                    ) as PromoteQuery["pagesize"],
                  })
                }
              >
                {pageSizes.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={locked || loading || applied.current <= 1}
                onClick={() =>
                  submit({ ...applied, current: applied.current - 1 })
                }
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  locked || loading || !!error || !matchingResult || end
                }
                onClick={() =>
                  submit({ ...applied, current: applied.current + 1 })
                }
              >
                下一页
              </Button>
            </div>
          </div>
        </div>
      </Card>
      <MaterialDetail row={selected} onClose={() => setSelected(null)} />
      {actions.dialogs}
    </>
  );
}
