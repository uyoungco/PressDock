import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
} from "react";
import {
  Download,
  LoaderCircle,
  RefreshCw,
  Settings2,
  MoreHorizontal,
} from "lucide-react";
import { Link } from "react-router-dom";
import { FlexRender } from "@tanstack/react-table";
import { isAndroid } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { LoadState } from "@/components/common/LoadState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useDataTable } from "@/hooks/use-data-table";
import { useColumnPreferences } from "@/hooks/use-column-preferences";
import { useAtom, useAtomValue } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { useBusinessQuery, useQueryUser } from "@/hooks/use-business-query";
import {
  businessKeys,
  harvestDateAtom,
  harvestUrlAtom,
  harvestNotificationErrorAtom,
  harvestNotificationsReadyAtom,
  invalidateBusinessQueries,
} from "@/lib/query-runtime";
import type { DataTableColumnDef } from "@/lib/data-table";
import { importService } from "@/features/import/service";
import {
  localCollectionDate,
  harvestStatus,
  type HarvestJob,
  type HarvestAction,
} from "@/features/import/contracts";
import { importUrlSchema } from "@/types/article";
import { importColumns as columnPreferences } from "@/features/import/table-model";
import {
  ImportTitle,
  ImportStatus,
  ImportActions,
} from "@/features/import/ImportRecord";
import { DesktopImportWorkspace } from "@/features/import/DesktopImportWorkspace";
import { useImportLayout } from "@/features/import/use-import-layout";

const pinnedEnd = ["actions"];
const statusVariants: Record<
  HarvestJob["status"],
  ComponentProps<typeof Badge>["variant"]
> = {
  queued: "warning",
  running: "warning",
  waitingUser: "warning",
  waitingLogin: "warning",
  succeeded: "success",
  debugCompleted: "secondary",
  failed: "destructive",
  cancelled: "secondary",
  interrupted: "secondary",
  submissionUnknown: "destructive",
};
const getRowId = (job: HarvestJob) => job.id;
const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : "采集操作失败，请重试";

export default function ImportPage() {
  const android = isAndroid();
  const { ref: workspaceRef, layout } = useImportLayout(!android);
  const userId = useQueryUser();
  const client = useQueryClient();
  const [desktopUrl, setDesktopUrl] = useState("");
  const [draftUrl, setDraftUrl] = useAtom(harvestUrlAtom);
  const url = android ? draftUrl : desktopUrl;
  const setUrl = android ? setDraftUrl : setDesktopUrl;
  const [busy, setBusy] = useState(false);
  const [rememberedDate, rememberDate] = useAtom(harvestDateAtom);
  const today = localCollectionDate();
  const date =
    !rememberedDate || rememberedDate.date === rememberedDate.today
      ? today
      : rememberedDate.date;
  const setDate = (value: string) =>
    rememberDate({ date: value, today: localCollectionDate() });
  const notificationsReady = useAtomValue(harvestNotificationsReadyAtom);
  const list = useBusinessQuery(
    businessKeys.harvestDate(userId, date),
    () => importService.list(date),
    userId === 0 || notificationsReady,
  );
  const jobs = list.data?.jobs ?? [];
  const loading = list.isPending;
  const error = list.error?.message ?? null;
  const [inputError, setInputError] = useState<string | null>(null);
  const notificationError = useAtomValue(harvestNotificationErrorAtom);
  const maintenanceWarning = list.data?.maintenanceWarning;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  // 弹窗读取实时任务数据，候选失效、任务结束或换号后不保留旧候选。
  const selectingJob = jobs.find(
    (job) => job.id === selectingId && job.status === "waitingUser",
  );
  const selectingTabs =
    selectingJob?.sourceInteraction?.kind === "selectTab"
      ? selectingJob.sourceInteraction.tabs
      : null;
  const [confirm, setConfirm] = useState<{
    job: HarvestJob;
    action: "confirmSubmitted" | "confirmNotSubmitted" | "delete";
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<{ id: string; url: string } | null>(null);
  const submitLock = useRef(false);
  const actionLock = useRef(false);
  const refresh = () => {
    void list.refetch();
  };
  const preferences = useColumnPreferences("import", columnPreferences);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = localCollectionDate();
      rememberDate((current) => {
        if (!current) return { date: next, today: next };
        if (current.today === next) return current;
        return {
          date: current.date === current.today ? next : current.date,
          today: next,
        };
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [rememberDate]);

  const act = useCallback(
    async (job: HarvestJob, action: HarvestAction) => {
      if (actionLock.current) return false;
      actionLock.current = true;
      setBusyId(job.id);
      try {
        await importService.action(job.id, action);
        void invalidateBusinessQueries(
          client,
          businessKeys.harvest(userId),
          businessKeys.articles(userId),
        );
        if (action === "delete") toast.success("采集记录已删除");
        return true;
      } catch (reason) {
        toast.error(message(reason));
        return false;
      } finally {
        actionLock.current = false;
        setBusyId(null);
      }
    },
    [client, userId],
  );
  const columns = useMemo<DataTableColumnDef<HarvestJob>[]>(() => {
    if (!android)
      return [
        {
          ...columnPreferences[0],
          header: "新闻内容",
          meta: { label: "新闻内容" },
          cell: ({ row: { original: job } }) => <ImportTitle job={job} />,
        },
        {
          ...columnPreferences[1],
          size: layout === "wide" ? 248 : 208,
          header: "状态",
          meta: { label: "状态" },
          cell: ({ row: { original: job } }) => <ImportStatus job={job} />,
        },
        {
          ...columnPreferences[2],
          size: layout === "wide" ? 272 : 232,
          header: "操作",
          meta: { label: "操作" },
          cell: ({ row: { original: job } }) => (
            <ImportActions
              job={job}
              disabled={busyId !== null}
              onAction={act}
              onSelect={(selected) => {
                setSelectedTarget(null);
                setSelectingId(selected.id);
              }}
              onConfirm={(selected, action) =>
                setConfirm({ job: selected, action })
              }
            />
          ),
        },
      ];
    return [
      {
        ...columnPreferences[0],
        header: "标题",
        meta: { label: "标题" },
        cell: ({ row: { original: job } }) => <ImportTitle job={job} />,
      },
      {
        ...columnPreferences[1],
        header: "状态",
        meta: { label: "状态" },
        cell: ({ row: { original: job } }) => (
          <div className="flex flex-col items-start gap-2">
            <Badge variant={statusVariants[job.status]}>
              {harvestStatus(job)}
            </Badge>
            {job.error && (
              <p className="text-xs break-words text-muted-foreground">
                {job.error}
              </p>
            )}
            {job.warnings.map((warning, index) => (
              <p
                key={index}
                className="text-xs break-words text-muted-foreground"
              >
                {warning}
              </p>
            ))}
          </div>
        ),
      },
      {
        ...columnPreferences[2],
        header: "操作",
        meta: { label: "操作" },
        cell: ({ row: { original: job } }) => (
          <div className="flex flex-wrap gap-1">
            {job.status === "waitingUser" &&
              job.sourceInteraction?.kind === "selectTab" && (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={busyId === job.id}
                  onClick={() => {
                    setSelectedTarget(null);
                    setSelectingId(job.id);
                  }}
                >
                  选择标签页
                </Button>
              )}
            {job.status === "waitingUser" &&
              job.sourceInteraction?.kind !== "selectTab" && (
                <>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={busyId === job.id}
                    onClick={() => void act(job, "show")}
                  >
                    {job.sourceMode === "cdp"
                      ? "打开浏览器标签页"
                      : "打开来源窗口"}
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={busyId === job.id}
                    onClick={() => void act(job, "resume")}
                  >
                    验证完成，继续
                  </Button>
                </>
              )}
            {["queued", "running", "waitingUser"].includes(job.status) && (
              <Button
                variant="ghost"
                size="xs"
                disabled={busyId === job.id}
                onClick={() => void act(job, "cancel")}
              >
                取消
              </Button>
            )}
            {["failed", "interrupted", "cancelled", "waitingLogin"].includes(
              job.status,
            ) && (
              <Button
                variant="outline"
                size="xs"
                disabled={busyId === job.id}
                onClick={() => void act(job, "retry")}
              >
                重试
              </Button>
            )}
            {/* 仅终态显示删除；后端仍原子校验状态，避免与重试并发删除任务。 */}
            {[
              "succeeded",
              "debugCompleted",
              "failed",
              "cancelled",
              "interrupted",
            ].includes(job.status) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${job.title || job.url}，更多操作`}
                    disabled={busyId !== null}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => setConfirm({ job, action: "delete" })}
                    >
                      删除记录
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {job.status === "submissionUnknown" && (
              <>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={busyId === job.id}
                  onClick={() =>
                    setConfirm({ job, action: "confirmSubmitted" })
                  }
                >
                  已核对：CMS 已添加
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={busyId === job.id}
                  onClick={() =>
                    setConfirm({ job, action: "confirmNotSubmitted" })
                  }
                >
                  已核对：CMS 未添加
                </Button>
              </>
            )}
          </div>
        ),
      },
    ];
  }, [act, busyId, android, layout]);
  const table = useDataTable({
    data: jobs,
    columns,
    preferences,
    getRowId,
    pinnedEnd,
  });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitLock.current) return;
    const parsed = importUrlSchema.safeParse(url.trim());
    if (!parsed.success) {
      setInputError(parsed.error.issues[0].message);
      return;
    }
    submitLock.current = true;
    setBusy(true);
    setInputError(null);
    // 请求结果丢失时保留相同 ID，重复回车不会创建第二条后台任务。
    if (request.current?.url !== parsed.data)
      request.current = { id: crypto.randomUUID(), url: parsed.data };
    try {
      const job = await importService.enqueue(
        request.current.id,
        request.current.url,
      );
      request.current = null;
      setUrl("");
      setDate(job.collectionDate);
      void invalidateBusinessQueries(
        client,
        businessKeys.harvest(userId),
        businessKeys.articles(userId),
      );
      toast.success(
        job.status === "queued"
          ? job.developerMode
            ? "已加入调试队列，仅保存本地结果，不创建 CMS 文章"
            : "已加入采集队列，将自动处理并提交 CMS"
          : "已定位该链接的已有采集记录",
      );
      window.requestAnimationFrame(() => input.current?.focus());
    } catch (reason) {
      setInputError(message(reason));
      toast.error(message(reason));
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      {android ? (
        <section
          data-slot="mobile-import"
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-2"
        >
          <div
            data-slot="mobile-import-heading"
            className="flex shrink-0 items-center justify-between gap-2"
          >
            <p className="text-sm text-muted-foreground">从来源文章开始</p>
            <Button asChild variant="outline" size="sm">
              <Link to="/settings?tab=harvest&returnTo=import">
                <Settings2 data-icon="inline-start" />
                采集设置
              </Link>
            </Button>
          </div>
          <form onSubmit={submit} className="shrink-0">
            <FieldGroup>
              <Field data-invalid={!!inputError}>
                <FieldLabel htmlFor="article-url" className="sr-only">
                  文章链接
                </FieldLabel>
                <div className="flex min-w-0 gap-2">
                  <Input
                    ref={input}
                    id="article-url"
                    type="url"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="粘贴百家号或 mbd 文章链接"
                    required
                    disabled={busy}
                    aria-invalid={!!inputError}
                    aria-describedby={inputError ? "import-error" : undefined}
                    className="h-11 min-w-0 flex-1"
                  />
                  <Button
                    type="submit"
                    disabled={busy}
                    className="h-11 shrink-0"
                  >
                    {busy ? (
                      <LoaderCircle
                        data-icon="inline-start"
                        className="animate-spin"
                      />
                    ) : (
                      <Download data-icon="inline-start" />
                    )}
                    {busy ? "入队中" : "开始采集"}
                  </Button>
                </div>
                {inputError && (
                  <p
                    id="import-error"
                    role="alert"
                    className="text-sm break-words text-destructive"
                  >
                    {inputError}
                  </p>
                )}
              </Field>
            </FieldGroup>
          </form>
          <div className="flex shrink-0 items-center gap-2">
            <label htmlFor="harvest-date" className="shrink-0 text-sm">
              采集记录
            </label>
            <Input
              id="harvest-date"
              type="date"
              value={date}
              onChange={(event) => {
                if (event.target.value) setDate(event.target.value);
              }}
              className="h-11 min-w-0 flex-1"
            />
            <Button
              variant="outline"
              size="icon"
              className="size-11 shrink-0"
              aria-label="刷新采集记录"
              disabled={list.isFetching}
              aria-busy={list.isFetching}
              onClick={refresh}
            >
              <RefreshCw className={cn(list.isFetching && "animate-spin")} />
            </Button>
          </div>
          <div
            role="region"
            aria-label="采集记录"
            tabIndex={0}
            data-slot="import-records"
            className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pb-2"
          >
            <p className="text-xs text-muted-foreground">
              应用保持前台时执行；完成后添加 CMS。退到后台会中断，返回后可重试。
            </p>
            <LoadState loading={loading} error={error} retry={refresh} />
            {notificationError && (
              <p
                role="alert"
                className="text-sm break-words text-muted-foreground"
              >
                {notificationError}
              </p>
            )}
            {maintenanceWarning && (
              <p
                role="alert"
                className="text-sm break-words text-muted-foreground"
              >
                启动历史清理未完成：{maintenanceWarning}
              </p>
            )}
            {!loading && !error && !jobs.length && (
              <p
                role="status"
                className="py-8 text-center text-sm text-muted-foreground"
              >
                {date === localCollectionDate()
                  ? "今天暂无采集记录"
                  : "该日期暂无采集记录"}
              </p>
            )}
            {table.getRowModel().rows.map((row) => (
              <div
                key={row.id}
                data-slot="mobile-import-record"
                className="shrink-0"
              >
                <div className="flex min-w-0 flex-col gap-3 p-3">
                  <article
                    aria-label={row.original.title || row.original.url}
                    className="flex min-w-0 flex-col gap-3"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <div key={cell.id} className="min-w-0">
                        <FlexRender cell={cell} />
                      </div>
                    ))}
                  </article>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <>
          <DesktopImportWorkspace
            workspaceRef={workspaceRef}
            layout={layout}
            table={table}
            jobs={jobs}
            inputRef={input}
            url={url}
            onUrlChange={setUrl}
            onSubmit={submit}
            busy={busy}
            inputError={inputError}
            date={date}
            onDateChange={setDate}
            onRefresh={refresh}
            fetching={list.isFetching}
            loading={loading}
            error={error}
            notificationError={notificationError}
            maintenanceWarning={maintenanceWarning}
          />
        </>
      )}
      <Dialog
        open={selectingTabs !== null}
        onOpenChange={(open) => {
          if (!open && !busyId) setSelectingId(null);
        }}
      >
        <DialogContent data-import-dialog={android ? "select-tabs" : undefined}>
          <DialogTitle>选择采集标签页</DialogTitle>
          <DialogDescription>
            同一文章链接匹配了多个标签页，请选择要读取的页面。关闭弹窗后任务继续等待，可稍后重新选择或取消任务。
          </DialogDescription>
          <FieldSet>
            <FieldLegend className="sr-only">候选标签页</FieldLegend>
            <FieldGroup className="max-h-80 overflow-y-auto">
              {selectingTabs?.map((tab) => (
                <Field key={tab.targetId} orientation="horizontal">
                  <input
                    id={`harvest-tab-${tab.targetId}`}
                    type="radio"
                    name="harvest-source-tab"
                    className="mt-1 size-4 accent-primary"
                    value={tab.targetId}
                    checked={selectedTarget === tab.targetId}
                    disabled={!!busyId}
                    onChange={() => setSelectedTarget(tab.targetId)}
                  />
                  <FieldContent className="min-w-0">
                    <FieldLabel htmlFor={`harvest-tab-${tab.targetId}`}>
                      {tab.title || "无标题"}
                    </FieldLabel>
                    <FieldDescription className="break-all">
                      {tab.url}
                    </FieldDescription>
                  </FieldContent>
                </Field>
              ))}
              {selectingTabs?.length === 0 && (
                <FieldDescription>
                  候选标签页均已失效，请关闭弹窗，取消任务后重试。
                </FieldDescription>
              )}
            </FieldGroup>
          </FieldSet>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={!!busyId}
              onClick={() => setSelectingId(null)}
            >
              稍后选择
            </Button>
            <Button
              disabled={
                !!busyId ||
                !selectingTabs?.some((tab) => tab.targetId === selectedTarget)
              }
              onClick={() => {
                if (!selectingJob || !selectedTarget || actionLock.current)
                  return;
                actionLock.current = true;
                setBusyId(selectingJob.id);
                void importService
                  .selectSourceTab(selectingJob.id, selectedTarget)
                  .then(() => setSelectingId(null))
                  .catch((reason) => toast.error(message(reason)))
                  .finally(() => {
                    actionLock.current = false;
                    setBusyId(null);
                    void invalidateBusinessQueries(
                      client,
                      businessKeys.harvest(userId),
                    );
                  });
              }}
            >
              读取所选标签页
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open && !busyId) setConfirm(null);
        }}
      >
        <DialogContent data-import-dialog={android ? "confirm" : undefined}>
          <DialogTitle>
            {confirm?.action === "delete"
              ? "删除这条采集记录？"
              : "确认已在 CMS 核对结果？"}
          </DialogTitle>
          <DialogDescription>
            {confirm?.action === "delete"
              ? "将删除本地采集记录及未被草稿引用的采集数据，CMS 中已有文章保留。删除后，相同链接可重新采集并再次提交 CMS。"
              : confirm?.action === "confirmSubmitted"
                ? "请先确认 CMS 已存在该文章。本操作只将本地记录标为已添加，不再次提交。"
                : "请先确认 CMS 确实没有该文章。本操作只将记录标为失败，之后可手动重试；不会立即重新提交。"}
          </DialogDescription>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={!!busyId}
              onClick={() => setConfirm(null)}
            >
              取消
            </Button>
            <Button
              variant={confirm?.action === "delete" ? "destructive" : "default"}
              disabled={!!busyId}
              onClick={() => {
                if (confirm)
                  void act(confirm.job, confirm.action).then((succeeded) => {
                    if (succeeded) setConfirm(null);
                  });
              }}
            >
              {confirm?.action === "delete" ? "确认删除" : "确认核对结果"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
