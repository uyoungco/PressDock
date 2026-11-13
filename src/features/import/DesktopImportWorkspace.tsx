import type { FormEvent, RefObject } from "react";
import { Download, LoaderCircle, RefreshCw, Settings2 } from "lucide-react";
import { Link } from "react-router-dom";
import { FlexRender } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DataTable } from "@/components/ui/data-table";
import { LoadState } from "@/components/common/LoadState";
import type { DataTableInstance } from "@/lib/data-table";
import { cn } from "@/lib/utils";
import { localCollectionDate, type HarvestJob } from "./contracts";
import { needsHarvestAttention } from "./table-model";
import "./import-workspace.css";

export function DesktopImportWorkspace({
  workspaceRef,
  layout,
  table,
  jobs,
  inputRef,
  url,
  onUrlChange,
  onSubmit,
  busy,
  inputError,
  date,
  onDateChange,
  onRefresh,
  fetching,
  loading,
  error,
  notificationError,
  maintenanceWarning,
}: {
  workspaceRef: RefObject<HTMLDivElement | null>;
  layout: "cards" | "compact" | "wide";
  table: DataTableInstance<HarvestJob>;
  jobs: HarvestJob[];
  inputRef: RefObject<HTMLInputElement | null>;
  url: string;
  onUrlChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  busy: boolean;
  inputError: string | null;
  date: string;
  onDateChange: (value: string) => void;
  onRefresh: () => void;
  fetching: boolean;
  loading: boolean;
  error: string | null;
  notificationError: string | null;
  maintenanceWarning: string | null | undefined;
}) {
  const attention = jobs.filter(needsHarvestAttention).length;
  const emptyMessage =
    date === localCollectionDate() ? "今天暂无采集记录" : "该日期暂无采集记录";
  return (
    <section
      className="import-workspace flex h-full min-h-0 min-w-0 flex-1 flex-col gap-4 px-2 py-2 md:px-3"
      data-import-layout={layout}
    >
      <h1 className="sr-only">素材导入</h1>
      <div
        ref={workspaceRef}
        data-slot="import-container"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-clip rounded-xl border bg-card"
      >
        <form
          onSubmit={onSubmit}
          className="import-composer shrink-0 border-b px-4 py-3"
        >
          <FieldGroup className="gap-0">
            <Field
              className="import-composer-field"
              data-invalid={!!inputError}
            >
              <FieldLabel htmlFor="article-url">文章链接</FieldLabel>
              <Input
                ref={inputRef}
                id="article-url"
                type="url"
                value={url}
                onChange={(event) => onUrlChange(event.target.value)}
                placeholder="粘贴百家号或 mbd.baidu.com 文章链接"
                required
                disabled={busy}
                aria-invalid={!!inputError}
                aria-describedby={
                  inputError ? "import-error import-help" : "import-help"
                }
                className="h-9 min-w-0"
              />
              <Button type="submit" size="lg" disabled={busy} aria-busy={busy}>
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
              <FieldDescription
                id="import-help"
                className="import-composer-help flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs leading-4"
              >
                <span>入队后可继续输入，离开页面仍会执行。</span>
                <span>调试任务仅保存本地，不提交 CMS</span>
              </FieldDescription>
              {inputError && (
                <p
                  id="import-error"
                  role="alert"
                  className="import-composer-help text-xs text-destructive"
                >
                  {inputError}
                </p>
              )}
            </Field>
          </FieldGroup>
        </form>
        <div className="import-toolbar flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
          <div className="flex items-baseline gap-3">
            <h2 className="text-sm font-medium">采集记录</h2>
            <span className="text-xs text-muted-foreground">
              {jobs.length} 条
              {attention > 0 && (
                <>
                  {" "}
                  ·{" "}
                  <span className="import-attention-count">
                    {attention} 条需处理
                  </span>
                </>
              )}
            </span>
          </div>
          <div className="import-tools flex min-w-0 items-center gap-2">
            <label
              htmlFor="harvest-date"
              className="shrink-0 text-xs text-muted-foreground"
            >
              采集日期
            </label>
            <Input
              id="harvest-date"
              type="date"
              value={date}
              onChange={(event) => {
                if (event.target.value) onDateChange(event.target.value);
              }}
              className="w-36 text-xs tabular-nums"
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="刷新采集记录"
              disabled={fetching}
              aria-busy={fetching}
              onClick={onRefresh}
            >
              <RefreshCw className={cn(fetching && "animate-spin")} />
            </Button>
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link to="/settings?tab=harvest&returnTo=import">
                <Settings2 data-icon="inline-start" />
                采集设置
              </Link>
            </Button>
          </div>
        </div>
        <ScrollArea
          orientation="both"
          className="import-record-scroll min-h-0 flex-1"
          viewportProps={{
            tabIndex: 0,
            role: "region",
            "aria-label": "采集记录滚动区域",
          }}
        >
          {(loading || error || notificationError || maintenanceWarning) && (
            <div className="flex flex-col gap-3 p-4">
              <LoadState loading={loading} error={error} retry={onRefresh} />
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
            </div>
          )}
          {jobs.length > 0 &&
            (layout === "cards" ? (
              <div className="import-cards flex flex-col">
                {table.getRowModel().rows.map((row) => (
                  <article
                    key={row.id}
                    aria-label={row.original.title || row.original.url}
                    data-needs-attention={needsHarvestAttention(row.original)}
                    data-job-status={row.original.status}
                    className="flex min-w-0 flex-col gap-2 border-b p-3 last:border-0"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <div key={cell.id} className="min-w-0">
                        <FlexRender cell={cell} />
                      </div>
                    ))}
                  </article>
                ))}
              </div>
            ) : (
              <DataTable
                table={table}
                aria-label="采集记录"
                externalScroll
                density="compact"
                stretchColumnId="title"
                getRowProps={({ original: job }) => ({
                  "aria-label": job.title || job.url,
                  "data-needs-attention": needsHarvestAttention(job),
                  "data-job-status": job.status,
                })}
              />
            ))}
          {!loading && !error && !jobs.length && (
            <div
              role="status"
              className="flex min-h-48 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground"
            >
              <p className="font-medium text-foreground">{emptyMessage}</p>
              <p className="text-xs">选择其他日期，或在上方提交文章链接。</p>
            </div>
          )}
        </ScrollArea>
        <div className="import-record-footer flex shrink-0 flex-wrap justify-between gap-x-3 border-t px-4 py-2 text-xs leading-5 text-muted-foreground">
          <span>仅显示所选日期的记录</span>
          <span>标题可打开原文</span>
        </div>
      </div>
    </section>
  );
}
