import { Link } from "react-router-dom";
import { ArrowRight, FileText } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { DataTableColumnSettings } from "@/components/ui/data-table-column-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { useDataTable } from "@/hooks/use-data-table";
import {
  useColumnPreferences,
  type PreferenceColumn,
} from "@/hooks/use-column-preferences";
import { useImportLayout } from "@/features/import/use-import-layout";
import { importService } from "@/features/import/service";
import { harvestStatus, type HarvestJob } from "@/features/import/contracts";
import type { DataTableColumnDef } from "@/lib/data-table";
import { harvestBadgeVariant } from "./model";
import { QueryNotice } from "./QueryNotice";

const columnPreferences: PreferenceColumn[] = [
  {
    id: "title",
    label: "标题及来源",
    size: 300,
    minSize: 240,
    maxSize: 960,
    enableHiding: false,
  },
  { id: "status", label: "实际状态", size: 176, minSize: 156, maxSize: 480 },
  { id: "updatedAt", label: "更新时间", size: 128, minSize: 120, maxSize: 320 },
];

function HarvestTitle({ job }: { job: HarvestJob }) {
  return (
    <div className="dashboard-harvest-title-cell">
      <a
        href={job.url}
        title={job.title || job.url}
        className="dashboard-harvest-title truncate underline-offset-4 hover:underline"
        onClick={(event) => {
          event.preventDefault();
          void importService
            .openSource(job.url)
            .catch((reason: unknown) =>
              toast.error(
                reason instanceof Error ? reason.message : "打开原文失败",
              ),
            );
        }}
      >
        {job.title || job.url}
      </a>
      <span className="dashboard-harvest-source truncate" title={job.url}>
        {new URL(job.url).hostname}
      </span>
    </div>
  );
}

function HarvestState({ job }: { job: HarvestJob }) {
  const note = [job.error, ...job.warnings].filter(Boolean).join("；");
  return (
    <div className="dashboard-harvest-state">
      <Badge
        variant={harvestBadgeVariant(job.status)}
        className="dashboard-harvest-status"
        data-status={job.status}
      >
        <span className="dashboard-status-dot" aria-hidden />
        {harvestStatus(job)}
      </Badge>
      {note && (
        <p className="dashboard-harvest-note w-full truncate" title={note}>
          {note}
        </p>
      )}
    </div>
  );
}

function UpdatedAt({ job }: { job: HarvestJob }) {
  const updated = new Date(job.updatedAt);
  return (
    <time
      dateTime={job.updatedAt}
      title={updated.toLocaleString("zh-CN", { hour12: false })}
      className="dashboard-harvest-time"
    >
      <span>
        {updated.toLocaleDateString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
        })}
      </span>
      <span>
        {updated.toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })}
      </span>
    </time>
  );
}

const columns: DataTableColumnDef<HarvestJob>[] = columnPreferences.map(
  (column) => ({
    ...column,
    header: column.label,
    meta: { label: column.label },
    cell: ({ row: { original: job } }) =>
      column.id === "title" ? (
        <HarvestTitle job={job} />
      ) : column.id === "status" ? (
        <HarvestState job={job} />
      ) : (
        <UpdatedAt job={job} />
      ),
  }),
);
const getRowId = (job: HarvestJob) => job.id;

export function RecentHarvest({
  jobs,
  loading,
  error,
  hasData,
  onRetry,
  openToday,
}: {
  jobs: HarvestJob[];
  loading: boolean;
  error: string | null;
  hasData: boolean;
  onRetry: () => void;
  openToday: () => void;
}) {
  const { ref, layout } = useImportLayout(true);
  const preferences = useColumnPreferences(
    "dashboard-harvest",
    columnPreferences,
  );
  const table = useDataTable({ data: jobs, columns, preferences, getRowId });
  return (
    <Card
      ref={ref}
      size="sm"
      className="dashboard-records min-w-0 gap-0 py-0"
      data-layout={layout}
    >
      <CardHeader className="dashboard-records-header">
        <div className="dashboard-records-heading">
          <CardTitle>
            <h2>最近采集记录</h2>
          </CardTitle>
          <CardDescription>今天 · 最近更新的 5 条</CardDescription>
        </div>
        <div className="dashboard-records-actions">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/import" onClick={openToday}>
              全部采集记录
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
          {layout !== "cards" && (
            <DataTableColumnSettings controller={preferences} />
          )}
        </div>
      </CardHeader>
      <CardContent className="border-t p-0">
        {error && (
          <div className="p-3">
            <QueryNotice
              error={error}
              stale={hasData}
              retry={onRetry}
              label="采集记录"
            />
          </div>
        )}
        {loading && (
          <Skeleton aria-label="正在加载采集记录" className="m-3 h-48" />
        )}
        {!loading && !jobs.length && hasData && (
          <div
            role="status"
            className="flex min-h-40 flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground"
          >
            <FileText className="size-6" />
            <p>今天暂无正式采集记录</p>
            <Button variant="outline" size="sm" asChild>
              <Link to="/import" onClick={openToday}>
                导入第一条素材
              </Link>
            </Button>
          </div>
        )}
        {!!jobs.length &&
          (layout === "cards" ? (
            <ul aria-label="最近采集记录" className="divide-y">
              {jobs.map((job) => (
                <li key={job.id} className="dashboard-harvest-card">
                  <HarvestTitle job={job} />
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <HarvestState job={job} />
                    </div>
                    <UpdatedAt job={job} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <DataTable
              table={table}
              aria-label="最近采集记录"
              stretchColumnId="title"
            />
          ))}
      </CardContent>
    </Card>
  );
}
