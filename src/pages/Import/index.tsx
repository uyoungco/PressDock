import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Download, Link2, LoaderCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { LoadState } from "@/components/common/LoadState";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useDataTable } from "@/hooks/use-data-table";
import {
  useColumnPreferences,
  type PreferenceColumn,
} from "@/hooks/use-column-preferences";
import { useAuth } from "@/hooks/use-auth";
import type { DataTableColumnDef } from "@/lib/data-table";
import { importService } from "@/features/import/service";
import {
  localCollectionDate,
  harvestStatus,
  type HarvestJob,
  type HarvestAction,
} from "@/features/import/contracts";
import { importUrlSchema } from "@/types/article";

const columnPreferences: PreferenceColumn[] = [
  {
    id: "title",
    label: "标题",
    size: 600,
    minSize: 240,
    maxSize: 1400,
    enableHiding: false,
  },
  {
    id: "status",
    label: "状态",
    size: 340,
    minSize: 240,
    maxSize: 640,
    enableHiding: false,
  },
];
const getRowId = (job: HarvestJob) => job.id;
const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : "采集操作失败，请重试";

export default function ImportPage() {
  const userId = useAuth().session?.user.userId;
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(localCollectionDate);
  const [jobs, setJobs] = useState<HarvestJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(
    null,
  );
  const [maintenanceWarning, setMaintenanceWarning] = useState<string | null>(
    null,
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    job: HarvestJob;
    action: "confirmSubmitted" | "confirmNotSubmitted" | "delete";
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<{ id: string; url: string } | null>(null);
  const submitLock = useRef(false);
  const actionLock = useRef(false);
  const refresh = useRef<() => void>(() => {});
  const preferences = useColumnPreferences("import", columnPreferences);

  useEffect(() => {
    let active = true;
    let running = false;
    let requested = false;
    let unlisten: (() => void) | undefined;
    setJobs([]);
    setNotificationError(null);
    setLoading(true);
    setError(null);
    // 先订阅再读快照；刷新串行合并，避免旧查询覆盖较新的持久状态。
    async function reload() {
      requested = true;
      if (running) return;
      running = true;
      try {
        while (requested && active) {
          requested = false;
          const next = await importService.list(date);
          if (active) {
            setJobs(next.jobs);
            setMaintenanceWarning(next.maintenanceWarning);
            setError(null);
          }
        }
      } catch (reason) {
        if (active) setError(message(reason));
      } finally {
        running = false;
        if (active) setLoading(false);
      }
    }
    refresh.current = () => {
      void reload();
    };
    importService
      .subscribe(() => {
        void reload();
      })
      .then((stop) => {
        if (!active) {
          stop();
          return;
        }
        unlisten = stop;
        void reload();
      })
      .catch((reason) => {
        if (active) {
          setNotificationError(
            `实时状态通知不可用，请手动刷新：${message(reason)}`,
          );
          void reload();
        }
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [date, userId]);
  useEffect(() => {
    let today = localCollectionDate();
    const timer = window.setInterval(() => {
      const next = localCollectionDate();
      if (next !== today) {
        const previous = today;
        today = next;
        setDate((current) => (current === previous ? next : current));
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const act = useCallback(async (job: HarvestJob, action: HarvestAction) => {
    if (actionLock.current) return false;
    actionLock.current = true;
    setBusyId(job.id);
    try {
      await importService.action(job.id, action);
      refresh.current();
      if (action === "delete") toast.success("采集记录已删除");
      return true;
    } catch (reason) {
      toast.error(message(reason));
      return false;
    } finally {
      actionLock.current = false;
      setBusyId(null);
    }
  }, []);
  const columns = useMemo<DataTableColumnDef<HarvestJob>[]>(
    () => [
      {
        ...columnPreferences[0],
        header: "标题",
        meta: { label: "标题" },
        cell: ({ row: { original: job } }) => (
          <a
            href={job.url}
            className="block text-left font-medium break-words hover:underline"
            title={job.title ?? job.url}
            onClick={(event) => {
              event.preventDefault();
              void importService
                .openSource(job.url)
                .catch((reason) => toast.error(message(reason)));
            }}
          >
            {job.title || job.url}
          </a>
        ),
      },
      {
        ...columnPreferences[1],
        header: "状态",
        meta: { label: "状态" },
        cell: ({ row: { original: job } }) => (
          <div className="flex flex-col items-start gap-2">
            <Badge
              variant={
                job.status === "failed" || job.status === "submissionUnknown"
                  ? "destructive"
                  : "secondary"
              }
            >
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
            <div className="flex flex-wrap gap-1">
              {job.status === "waitingUser" && (
                <>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={busyId === job.id}
                    onClick={() => void act(job, "show")}
                  >
                    打开来源窗口
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
                <Button
                  variant="outline"
                  size="xs"
                  disabled={busyId === job.id}
                  onClick={() => setConfirm({ job, action: "delete" })}
                >
                  删除
                </Button>
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
          </div>
        ),
      },
    ],
    [act, busyId],
  );
  const table = useDataTable({ data: jobs, columns, preferences, getRowId });
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
      setJobs((previous) => [
        job,
        ...previous.filter(
          (item) =>
            item.id !== job.id && item.collectionDate === job.collectionDate,
        ),
      ]);
      refresh.current();
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
      <PageHeader
        title="素材导入"
        description="提交文章链接，后台采集并处理；调试任务仅保存本地，正常任务添加到 CMS。"
        demo={false}
      />
      <div className="flex flex-col gap-5">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 />
              通过链接采集
            </CardTitle>
            <CardDescription>
              支持百家号与
              mbd.baidu.com。入队后可继续输入，离开页面任务仍会执行。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-3">
              <label htmlFor="article-url" className="text-sm font-medium">
                文章链接
              </label>
              <div className="flex flex-wrap gap-3">
                <Input
                  ref={input}
                  id="article-url"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="粘贴文章链接，按回车开始采集"
                  required
                  disabled={busy}
                  aria-invalid={!!inputError}
                  aria-describedby={inputError ? "import-error" : undefined}
                  className="min-w-60 flex-1"
                />
                <Button type="submit" disabled={busy}>
                  {busy ? (
                    <LoaderCircle
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : (
                    <Download data-icon="inline-start" />
                  )}
                  {busy ? "正在入队…" : "开始采集"}
                </Button>
              </div>
              {inputError && (
                <p
                  id="import-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {inputError}
                </p>
              )}
            </form>
          </CardContent>
        </Card>
        <Card className="min-w-0 shadow-none">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle>采集记录</CardTitle>
              <CardDescription>
                默认显示当天。点击标题打开原文，完成后直接添加到 CMS。
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="harvest-date" className="sr-only">
                采集日期
              </label>
              <Input
                id="harvest-date"
                type="date"
                value={date}
                onChange={(event) => {
                  if (event.target.value) setDate(event.target.value);
                }}
                className="w-40"
              />
              <Button
                variant="outline"
                size="icon"
                aria-label="刷新采集记录"
                onClick={() => refresh.current()}
              >
                <RefreshCw />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-3">
            <LoadState loading={loading} error={error} />
            {notificationError && (
              <p role="alert" className="text-sm text-muted-foreground">
                {notificationError}
              </p>
            )}
            {maintenanceWarning && (
              <p role="alert" className="text-sm text-muted-foreground">
                启动历史清理未完成：{maintenanceWarning}
              </p>
            )}
            <DataTable
              table={table}
              aria-label="采集记录"
              emptyMessage={
                date === localCollectionDate()
                  ? "今天暂无采集记录"
                  : "该日期暂无采集记录"
              }
            />
          </CardContent>
        </Card>
      </div>
      <Dialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open && !busyId) setConfirm(null);
        }}
      >
        <DialogContent>
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
