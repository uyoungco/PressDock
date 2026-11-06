import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RefreshCw,
  SlidersHorizontal,
  Plus,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { MaterialImage } from "./MaterialImage";
import { pageSizes } from "@/types/cms";
import type { useChannelController } from "./use-channel-controller";

export function MobileChannelView({
  controller: c,
}: {
  controller: ReturnType<typeof useChannelController>;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [selection, setSelection] = useState<"channel" | "subchannel" | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const rows = c.actions.sorted ?? c.matchingResult?.data ?? [];
  const options =
    selection === "channel" ? c.groups.map((g) => g.channel) : c.subchannels;
  const choices = [
    "",
    ...new Set([
      ...options,
      ...(selection && c.draft[selection] ? [c.draft[selection]] : []),
    ]),
  ].filter(
    (value) =>
      !search || value.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const closeFilter = () => {
    setFilterOpen(false);
    setSelection(null);
    setSearch("");
    c.setDraft(c.applied);
  };
  return (
    <section
      className="flex min-h-0 flex-1 flex-col [&_[data-slot=button]]:min-h-11!"
      aria-label="渠道素材管理"
    >
      <div
        data-slot="mobile-channel-toolbar"
        className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2"
      >
        {c.actions.hasRetainedDraft && (
          <Button
            className="h-11 w-full"
            variant="secondary"
            onClick={c.actions.resumeDraft}
          >
            继续本机草稿
          </Button>
        )}
        {/* 排序时只保留提交与取消；禁用原因不再独占一整行。 */}
        {c.actions.sorting ? (
          <>
            <Button
              disabled={c.actions.busy}
              onClick={() => void c.actions.saveOrder()}
            >
              保存当前页排序
            </Button>
            <Button
              variant="ghost"
              disabled={c.actions.busy}
              onClick={c.actions.cancelSort}
            >
              取消排序
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              disabled={c.locked}
              onClick={() => {
                c.setDraft(c.applied);
                setFilterOpen(true);
              }}
            >
              <SlidersHorizontal data-icon="inline-start" />
              筛选{" "}
              {[
                c.applied.channel,
                c.applied.subchannel,
                c.applied.publishdate,
              ].filter(Boolean).length || ""}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="刷新素材列表"
              disabled={c.locked || c.list.isFetching}
              onClick={c.refresh}
            >
              <RefreshCw
                data-icon="inline-start"
                className={c.list.isFetching ? "animate-spin" : undefined}
              />
            </Button>
            <Button
              variant="ghost"
              title={c.sortReason || undefined}
              aria-describedby={c.sortReason ? "mobile-sort-reason" : undefined}
              disabled={c.actions.busy || !!c.sortReason}
              onClick={() => c.actions.startSort(rows)}
            >
              排序
            </Button>
            {c.sortReason && (
              <span id="mobile-sort-reason" className="sr-only">
                {c.sortReason}
              </span>
            )}
            <Button
              className="ml-auto"
              disabled={c.locked}
              onClick={c.actions.create}
            >
              <Plus data-icon="inline-start" />
              新增
            </Button>
          </>
        )}
        {[c.applied.channel, c.applied.subchannel, c.applied.publishdate].some(
          Boolean,
        ) && (
          <div
            data-slot="mobile-channel-conditions"
            className="mobile-condition-summary w-full truncate"
            aria-label="已应用条件"
          >
            {[c.applied.channel, c.applied.subchannel, c.applied.publishdate]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}
      </div>
      <div
        ref={c.listViewport}
        role="region"
        aria-label="渠道素材内容"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {(c.error || c.groupsError) && (
          <Alert variant="destructive">
            <AlertDescription>
              {c.error || c.groupsError}
              <Button
                variant="outline"
                onClick={() => {
                  c.refresh();
                  void c.groupQuery.refetch();
                }}
              >
                重试
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {c.loading && (
          <p role="status" className="p-4">
            正在加载素材…
          </p>
        )}
        {!c.loading && !c.error && !rows.length && (
          <p className="p-6 text-muted-foreground">暂无符合条件的素材</p>
        )}
        <ul className="divide-y">
          {rows.map((row, i) => (
            <li
              key={row.id}
              data-material-id={row.id}
              data-slot="mobile-channel-item"
              className="flex flex-col gap-3 p-3"
              data-selected={c.selected?.id === row.id || undefined}
            >
              <button
                type="button"
                className="min-h-11! text-left font-medium leading-relaxed"
                onClick={() => c.setSelected(row)}
                disabled={c.locked}
              >
                <span className="line-clamp-2">{row.title || "无标题"}</span>
              </button>
              <div
                data-slot="mobile-material-images"
                className="flex flex-wrap gap-2 [&_[data-slot=material-image]>div:first-child:has(button)]:h-auto! [&_[data-slot=material-image]>div:first-child:has(button)]:min-h-20"
              >
                <MaterialImage
                  compact
                  url={row.titlePic}
                  label="主图"
                  onPreview={() => c.setSelected(row)}
                />
                {row.titlePic2 && (
                  <MaterialImage
                    compact
                    url={row.titlePic2}
                    label="第二张图片"
                    onPreview={() => c.setSelected(row)}
                  />
                )}
              </div>
              <p className="break-words text-sm text-muted-foreground">
                {[row.channel, row.subChannel].filter(Boolean).join(" · ")}
                {/* 日期整体换行，避免窄屏把年月日拆成两行。 */}
                {row.publishDate && (
                  <span className="inline-block whitespace-nowrap">
                    {" · "}
                    {row.publishDate.slice(0, 10)}
                  </span>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {c.actions.sorting ? (
                  <>
                    <span>第 {i + 1} 位</span>
                    <Button
                      className="h-11"
                      variant="outline"
                      disabled={c.actions.busy || i === 0}
                      onClick={() => c.actions.move(row.id, rows[i - 1].id)}
                    >
                      上移
                    </Button>
                    <Button
                      className="h-11"
                      variant="outline"
                      disabled={c.actions.busy || i === rows.length - 1}
                      onClick={() => c.actions.move(row.id, rows[i + 1].id)}
                    >
                      下移
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      className="h-11"
                      variant="ghost"
                      disabled={c.locked}
                      onClick={() => void c.actions.beginEdit(row)}
                    >
                      编辑
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`素材 ${row.id} 更多操作`}
                          disabled={c.locked}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => c.actions.requestDelete(row)}
                          >
                            删除素材
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div
        data-slot="mobile-pagination"
        className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-3 py-2"
        aria-label="素材分页"
      >
        <label className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
          第 {c.applied.current} 页
          <select
            aria-label="每页条数"
            className="h-11! min-h-11! min-w-0 max-w-full rounded-md border bg-background px-1"
            value={c.applied.pagesize}
            disabled={c.locked}
            onChange={(e) =>
              c.submit({
                ...c.applied,
                current: 1,
                pagesize: Number(e.target.value) as typeof c.applied.pagesize,
              })
            }
          >
            {pageSizes.map((n) => (
              <option key={n} value={n}>
                {n} 条/页
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <Button
            size="sm"
            className="h-11"
            variant="outline"
            disabled={c.locked || c.loading || c.applied.current <= 1}
            onClick={() =>
              c.submit({ ...c.applied, current: c.applied.current - 1 })
            }
          >
            上一页
          </Button>
          <Button
            size="sm"
            className="h-11"
            variant="outline"
            disabled={
              c.locked || c.loading || !!c.error || !c.matchingResult || c.end
            }
            onClick={() =>
              c.submit({ ...c.applied, current: c.applied.current + 1 })
            }
          >
            下一页
          </Button>
        </div>
      </div>
      <Sheet
        open={filterOpen}
        onOpenChange={(open) => {
          if (!open) closeFilter();
        }}
      >
        <SheetContent
          side="bottom"
          data-mobile-fullscreen
          className="flex max-h-[90dvh] flex-col overflow-hidden rounded-t-xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] [&_button]:min-h-11! [&_input]:min-h-11! [&_[data-slot=sheet-close]]:min-w-11!"
          onEscapeKeyDown={(e) => {
            if (selection) {
              e.preventDefault();
              setSelection(null);
              setSearch("");
            }
          }}
        >
          {/* 标题和底部操作固定，选项及表单仅在中间区域滚动。 */}
          <div className="flex shrink-0 flex-col gap-2 pr-12">
            <SheetTitle>
              {selection
                ? `选择${selection === "channel" ? "渠道" : "子渠道"}`
                : "筛选渠道素材"}
            </SheetTitle>
            <SheetDescription>
              {selection ? "选择后返回筛选。" : "设置条件后点击应用。"}
            </SheetDescription>
          </div>
          {selection ? (
            <>
              <Button
                variant="outline"
                className="h-11"
                onClick={() => {
                  setSelection(null);
                  setSearch("");
                }}
              >
                返回筛选
              </Button>
              <Input
                aria-label="搜索选项"
                placeholder={`搜索${selection === "channel" ? "渠道" : "子渠道"}名称`}
                className="h-11 shrink-0"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div
                role="listbox"
                aria-label="可选条件"
                className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
              >
                {choices.map((value) => (
                  <Button
                    key={value}
                    role="option"
                    aria-selected={c.draft[selection] === value}
                    variant={
                      c.draft[selection] === value ? "secondary" : "ghost"
                    }
                    className="h-auto min-h-11 justify-start whitespace-normal text-left"
                    onClick={() => {
                      c.setDraft({
                        ...c.draft,
                        [selection]: value,
                        ...(selection === "channel" ? { subchannel: "" } : {}),
                      });
                      setSelection(null);
                      setSearch("");
                    }}
                  >
                    {value || "全部"}
                  </Button>
                ))}
                {!choices.length && <p>未找到匹配项</p>}
              </div>
            </>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <FieldGroup>
                  <Field>
                    <FieldLabel>渠道</FieldLabel>
                    <Button
                      className="h-auto min-h-11 justify-start whitespace-normal text-left"
                      variant="outline"
                      disabled={c.groupsLoading || !!c.groupsError}
                      onClick={() => setSelection("channel")}
                    >
                      {c.draft.channel || "全部渠道"}
                    </Button>
                  </Field>
                  <Field>
                    <FieldLabel>子渠道</FieldLabel>
                    <Button
                      className="h-auto min-h-11 justify-start whitespace-normal text-left"
                      variant="outline"
                      disabled={
                        !c.draft.channel || c.groupsLoading || !!c.groupsError
                      }
                      onClick={() => setSelection("subchannel")}
                    >
                      {c.draft.subchannel || "全部子渠道"}
                    </Button>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="mobile-publish-date">
                      发布日期
                    </FieldLabel>
                    <Input
                      id="mobile-publish-date"
                      type="date"
                      className="h-11"
                      value={c.draft.publishdate}
                      onChange={(e) =>
                        c.setDraft({ ...c.draft, publishdate: e.target.value })
                      }
                    />
                  </Field>
                </FieldGroup>
              </div>
              <div className="flex shrink-0 gap-2 border-t pt-3">
                <Button
                  variant="outline"
                  className="h-11 flex-1"
                  onClick={() =>
                    c.setDraft({
                      ...c.applied,
                      channel: "",
                      subchannel: "",
                      publishdate: "",
                      current: 1,
                    })
                  }
                >
                  清空
                </Button>
                <Button
                  className="h-11 flex-1"
                  onClick={() => {
                    c.submit({ ...c.draft, current: 1 });
                    setFilterOpen(false);
                  }}
                >
                  应用筛选
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}
