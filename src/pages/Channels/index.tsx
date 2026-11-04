import { useIsMobile } from "@/hooks/use-mobile";
import { isAndroid } from "@/lib/platform";
import { useChannelController } from "@/features/channels/use-channel-controller";
import { MobileChannelView } from "@/features/channels/MobileChannelView";
import { Navigate, useSearchParams } from "react-router-dom";
import { Copy, RefreshCw, RotateCcw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/common/SearchableSelect";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { MaterialImage } from "@/features/channels/MaterialImage";
import { useAtomValue } from "jotai";
import { channelFilterAtom } from "@/lib/query-runtime";
import { MaterialTable } from "@/features/channels/MaterialTable";
import { materialColumnPreferences } from "@/features/channels/table-model";
import { useColumnPreferences } from "@/hooks/use-column-preferences";
import { DataTableColumnSettings } from "@/components/ui/data-table-column-settings";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  channelQueryParams,
  readChannelQuery,
} from "@/features/channels/service";
import {
  pageSizes,
  type PromoteQuery,
  type PromoteRecord,
  type PromoteField,
} from "@/types/cms";

const show = (value: string | number | null) =>
  value === "" || value === null ? "—" : String(value);
function MaterialDetail({
  row,
  onClose,
  onEdit,
}: {
  row: PromoteRecord | null;
  onClose: () => void;
  onEdit?: (row: PromoteRecord) => void;
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
      <DialogContent
        data-channel-dialog={isAndroid() ? "detail" : undefined}
        className="flex max-h-[85dvh] flex-col sm:max-w-3xl"
      >
        <DialogTitle>素材详情</DialogTitle>
        <DialogDescription>
          查看渠道素材的标题、摘要和关联信息。
        </DialogDescription>
        {row && onEdit && (
          <Button
            className="shrink-0"
            variant="outline"
            onClick={() => {
              onClose();
              onEdit(row);
            }}
          >
            编辑此素材
          </Button>
        )}
        {row && (
          <ScrollArea
            className="-mx-1 flex-1"
            viewportProps={{ className: "px-1 py-1" }}
          >
            {/* 手机先确认素材内容，再查看图片；技术字段保留在下方。 */}
            {isAndroid() && (
              <div className="mb-4 flex flex-col gap-2">
                <h2 className="text-base font-medium">
                  {row.title || "无标题"}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {[row.channel, row.subChannel, row.publishDate?.slice(0, 10)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="whitespace-pre-wrap text-sm">
                  {row.smallText || "暂无摘要"}
                </p>
              </div>
            )}
            <div
              data-slot={isAndroid() ? "mobile-detail-images" : undefined}
              className={cn(
                "grid gap-3 sm:grid-cols-2",
                isAndroid() && "grid-cols-2",
              )}
            >
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
              {fields
                .filter(
                  ([field]) =>
                    !isAndroid() ||
                    ![
                      "title",
                      "smallText",
                      "channel",
                      "subChannel",
                      "publishDate",
                    ].includes(field),
                )
                .map(([field, label]) => (
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
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Channels() {
  const [params] = useSearchParams();
  const remembered = useAtomValue(channelFilterAtom);
  if (!params.size) {
    return (
      <Navigate
        replace
        to={{
          pathname: "/channels",
          search: `?${channelQueryParams(remembered ?? { ...readChannelQuery(params), ...(isAndroid() ? { pagesize: 20 as const } : {}) })}`,
        }}
      />
    );
  }
  return <ChannelResults />;
}

function ChannelResults() {
  const columnPreferences = useColumnPreferences(
    "channels",
    materialColumnPreferences,
  );
  const controller = useChannelController();
  const {
    applied,
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
  } = controller;
  const compact = useIsMobile();
  if (isAndroid() || compact)
    return (
      <>
        <MobileChannelView controller={controller} />
        <MaterialDetail
          row={selected}
          onClose={() => setSelected(null)}
          onEdit={(row) => {
            void actions.beginEdit(row);
          }}
        />
        {actions.dialogs}
      </>
    );
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
            <div className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground md:min-w-36">
              <label htmlFor="channel-filter">渠道</label>
              <SearchableSelect
                id="channel-filter"
                aria-label="渠道"
                className="h-7 w-full max-md:min-h-11"
                value={draft.channel}
                options={[
                  { value: "", label: "全部渠道" },
                  ...groups.map((group) => ({
                    value: group.channel,
                    label: group.channel,
                  })),
                ]}
                searchPlaceholder="搜索渠道…"
                disabled={locked || groupsLoading || !!groupsError}
                onValueChange={(value) =>
                  setDraft({
                    ...draft,
                    channel: value,
                    subchannel: "",
                  })
                }
              />
            </div>
            <div className="col-span-2 flex min-w-0 flex-col gap-1 text-xs text-muted-foreground md:w-[28rem] md:max-w-full">
              <label htmlFor="subchannel-filter">子渠道</label>
              <SearchableSelect
                id="subchannel-filter"
                aria-label="子渠道"
                className="h-auto min-h-7 w-full py-1 max-md:min-h-11"
                wrapLabels
                value={draft.subchannel}
                options={[
                  { value: "", label: "全部子渠道" },
                  ...subchannels.map((value) => ({ value, label: value })),
                ]}
                searchPlaceholder="搜索子渠道…"
                disabled={
                  locked || !draft.channel || groupsLoading || !!groupsError
                }
                onValueChange={(value) =>
                  setDraft({ ...draft, subchannel: value })
                }
              />
            </div>
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
          <Button
            variant="outline"
            size="sm"
            disabled={locked || list.isFetching}
            onClick={refresh}
            aria-label="刷新渠道素材"
            aria-busy={list.isFetching}
          >
            <RefreshCw
              data-icon="inline-start"
              className={cn(list.isFetching && "animate-spin")}
            />
            刷新
          </Button>
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
          <div className="ml-auto">
            <DataTableColumnSettings
              controller={columnPreferences}
              disabled={locked}
            />
          </div>
        </div>
        <ScrollArea
          viewportRef={listViewport}
          orientation="both"
          className="flex-1"
          viewportProps={{
            role: "region",
            "aria-label": "渠道素材内容",
            tabIndex: 0,
            className: "overscroll-contain",
          }}
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
                onClick={() => void groupQuery.refetch()}
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
          ) : null}
          {error && (
            <div role="alert" className="space-y-3 p-6 text-sm">
              <p className="text-destructive">{error}</p>
              <Button variant="outline" onClick={refresh}>
                重试素材列表
              </Button>
            </div>
          )}
          {matchingResult && (
            <MaterialTable
              preferences={columnPreferences}
              rows={actions.sorted ?? matchingResult.data}
              sorting={actions.sorting}
              busy={actions.busy}
              onMove={actions.move}
              onDetail={setSelected}
              onEdit={(row) => void actions.beginEdit(row)}
              onDelete={actions.requestDelete}
            />
          )}
        </ScrollArea>
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
            <div className="flex items-center gap-2">
              <label htmlFor="page-size-filter">每页条数</label>
              <Select<PromoteQuery["pagesize"]>
                disabled={locked}
                items={pageSizes.map((value) => ({
                  value,
                  label: String(value),
                }))}
                value={applied.pagesize}
                onValueChange={(value) => {
                  if (value !== null)
                    submit({
                      ...applied,
                      current: 1,
                      pagesize: value,
                    });
                }}
              >
                <SelectTrigger
                  id="page-size-filter"
                  aria-label="每页条数"
                  size="sm"
                  className="min-w-16 max-md:min-h-11"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pageSizes.map((size) => (
                    <SelectItem key={size} value={size}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
      <MaterialDetail
        row={selected}
        onClose={() => setSelected(null)}
        onEdit={(row) => {
          void actions.beginEdit(row);
        }}
      />
      {actions.dialogs}
    </>
  );
}
