import { createContext, useContext } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { useDataTable } from "@/hooks/use-data-table";
import type { ColumnPreferencesController } from "@/hooks/use-column-preferences";
import type { DataTableColumnDef } from "@/lib/data-table";
import { MaterialImage } from "@/features/channels/MaterialImage";
import type { ArticleView, CmsArticleRow } from "@/types/cms-article";
import {
  articleColumns,
  articleImageUrl,
  articleService,
  articleUrl,
} from "./service";

type Actions = {
  view: ArticleView;
  busy: boolean;
  onEdit: (row: CmsArticleRow) => void;
  onPromote: (row: CmsArticleRow) => void;
  onPreview: (url: string) => void;
};
const Context = createContext<Actions | null>(null);
async function open(url: string) {
  try {
    await articleService.openLink(url);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "打开链接失败");
  }
}
function Cell({
  row,
  field,
}: {
  row: CmsArticleRow;
  field: (typeof articleColumns)[number]["id"];
}) {
  const actions = useContext(Context)!;
  if (field === "actions")
    return (
      <div className="flex">
        <Button
          variant="ghost"
          size="sm"
          disabled={actions.busy}
          onClick={() => actions.onEdit(row)}
        >
          编辑
        </Button>
        {actions.view === "quality" && (
          <Button
            variant="ghost"
            size="sm"
            disabled={actions.busy}
            onClick={() => actions.onPromote(row)}
          >
            添加到渠道素材
          </Button>
        )}
      </div>
    );
  if (field === "titlePic" || field === "titlePic2" || field === "titlePic3") {
    const url = articleImageUrl(row[field]);
    return (
      <MaterialImage
        compact
        url={url}
        label={field}
        onPreview={() => url && actions.onPreview(url)}
      />
    );
  }
  if (field === "title" || field === "id" || field === "sourceUrl")
    return (
      <button
        role="link"
        className="w-full text-left break-words text-primary hover:underline disabled:text-muted-foreground"
        disabled={field === "sourceUrl" && !row.sourceUrl}
        onClick={() =>
          void open(
            field === "sourceUrl"
              ? row.sourceUrl!
              : articleUrl(actions.view, row.id),
          )
        }
      >
        {row[field] || "—"}
      </button>
    );
  if (field === "tags" || field === "nTags")
    return (
      <div className="flex flex-wrap gap-1">
        {row[field].length
          ? row[field].map((value, index) => (
              <Badge key={index} variant="secondary">
                {value}
              </Badge>
            ))
          : "—"}
      </div>
    );
  if (field === "comment")
    return (
      <div className="space-y-1 break-words">
        {row.commentRecommand && <p>{row.commentRecommand}</p>}
        {row.commentPromote.map((value, i) => (
          <p key={i}>{value}</p>
        ))}
        {!row.commentRecommand && !row.commentPromote.length && "—"}
      </div>
    );
  return <span className="break-words">{row[field] ?? "—"}</span>;
}
// 静态列配合上下文，调整列宽时保留图片组件及其懒加载状态。
const columns: DataTableColumnDef<CmsArticleRow>[] = articleColumns.map(
  (config) => ({
    ...config,
    header: config.label,
    meta: { label: config.label },
    cell: ({ row }) => <Cell row={row.original} field={config.id} />,
  }),
);
const pinnedEnd = ["actions"];
const getRowId = (row: CmsArticleRow) => String(row.id);
export function ArticleTable({
  rows,
  preferences,
  ...actions
}: Actions & {
  rows: CmsArticleRow[];
  preferences: ColumnPreferencesController;
}) {
  const table = useDataTable({
    data: rows,
    columns,
    preferences,
    getRowId,
    pinnedEnd,
  });
  return (
    <Context value={actions}>
      <DataTable
        table={table}
        aria-label="CMS 文章列表"
        externalScroll
        resizeDisabled={actions.busy}
        emptyMessage="暂无符合条件的文章"
      />
    </Context>
  );
}
