import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { DataTableColumnSettings } from "@/components/ui/data-table-column-settings";
import { useDataTable } from "@/hooks/use-data-table";
import {
  useColumnPreferences,
  type PreferenceColumn,
  type TablePreferenceKey,
} from "@/hooks/use-column-preferences";
import type { DataTableColumnDef } from "@/lib/data-table";
import { STATUS_LABELS } from "@/constants/app";
import type { Article } from "@/types/article";

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
const columnPreferences: PreferenceColumn[] = [
  {
    id: "title",
    label: "文章标题",
    size: 360,
    minSize: 224,
    maxSize: 960,
    enableHiding: false,
  },
  { id: "source", label: "来源", size: 200, minSize: 120, maxSize: 600 },
  { id: "createdAt", label: "创建时间", size: 176, minSize: 128, maxSize: 480 },
  { id: "updatedAt", label: "更新时间", size: 176, minSize: 128, maxSize: 480 },
  { id: "status", label: "状态", size: 144, minSize: 112, maxSize: 320 },
];
const cells: Record<string, DataTableColumnDef<Article>["cell"]> = {
  title: ({ row: { original: article } }) => (
    <div className="break-words">
      <span className="font-medium">{article.title}</span>
      {article.isDemo && (
        <span className="ml-2 text-xs text-muted-foreground">演示</span>
      )}
    </div>
  ),
  source: ({ row: { original: article } }) => (
    <span
      className="block truncate text-muted-foreground"
      title={new URL(article.source.url).hostname}
    >
      {new URL(article.source.url).hostname}
    </span>
  ),
  createdAt: ({ row: { original: article } }) => (
    <span className="text-xs text-muted-foreground">
      {formatDate(article.createdAt)}
    </span>
  ),
  updatedAt: ({ row: { original: article } }) => (
    <span className="text-xs text-muted-foreground">
      {formatDate(article.updatedAt)}
    </span>
  ),
  status: ({ row: { original: article } }) => (
    <Badge variant={article.status === "failed" ? "destructive" : "secondary"}>
      {STATUS_LABELS[article.status]}
    </Badge>
  ),
};
const columns: DataTableColumnDef<Article>[] = columnPreferences.map(
  (column) => ({
    ...column,
    header: column.label,
    meta: { label: column.label },
    cell: cells[column.id],
  }),
);
const getRowId = (row: Article) => row.id;

export function ArticleTable({
  articles,
  preferenceKey,
}: {
  articles: Article[];
  preferenceKey: Exclude<TablePreferenceKey, "channels">;
}) {
  const preferences = useColumnPreferences(preferenceKey, columnPreferences);
  const table = useDataTable({
    data: articles,
    columns,
    preferences,
    getRowId,
  });
  return (
    <div className="min-w-0">
      <div className="flex justify-end border-b px-4 py-2">
        <DataTableColumnSettings controller={preferences} />
      </div>
      <DataTable
        table={table}
        aria-label="文章列表"
        emptyMessage={
          <div className="flex flex-col items-center gap-2">
            <FileText className="size-7" />
            <p>暂无符合条件的文章</p>
          </div>
        }
      />
    </div>
  );
}
