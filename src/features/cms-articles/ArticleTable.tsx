import { createContext, useContext, useState } from "react";
import { toast } from "sonner";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { ArticleReviewController } from "./use-article-review";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
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
  review?: ArticleReviewController;
  view: ArticleView;
  busy: boolean;
  onEdit: (row: CmsArticleRow) => void;
  onPromote: (row: CmsArticleRow) => void;
  onPreview: (url: string) => void;
};
type Layout = "wide" | "compact" | "cards";
const Context = createContext<
  | (Actions & {
      compact: boolean;
      showDistribution: boolean;
      inspect: (row: CmsArticleRow) => void;
    })
  | null
>(null);
async function open(url: string) {
  try {
    await articleService.openLink(url);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "打开链接失败");
  }
}
function Distribution({ row }: { row: CmsArticleRow }) {
  const text = [row.commentRecommand, ...row.commentPromote]
    .filter(Boolean)
    .join("；");
  return (
    <div className="article-distribution" title={text || "暂无分发记录"}>
      {text ? (
        <>
          <span>
            {row.commentRecommand ? "已推荐" : "未推荐"} · 分发{" "}
            {row.commentPromote.length} 处
          </span>
          <p className="truncate text-muted-foreground">
            {row.commentPromote[0] || row.commentRecommand}
          </p>
        </>
      ) : (
        <span className="text-muted-foreground">暂无分发记录</span>
      )}
    </div>
  );
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
      <div className="article-row-actions">
        <Button
          variant="ghost"
          size="sm"
          disabled={actions.busy}
          onClick={() => actions.onEdit(row)}
        >
          编辑
        </Button>
        {actions.review?.allowed && (
          <Button
            variant="ghost"
            size="sm"
            disabled={actions.busy}
            onClick={() => void actions.review?.begin([row], true)}
          >
            审核
          </Button>
        )}
        {actions.view === "quality" && (
          <Button
            variant="ghost"
            size="sm"
            title="添加到渠道素材"
            disabled={actions.busy}
            onClick={() => actions.onPromote(row)}
          >
            转素材
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`文章 ${row.id} 更多操作`}
              disabled={actions.busy}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem
                onSelect={() => void open(articleUrl(actions.view, row.id))}
              >
                {actions.view === "quality" ? "打开文章" : "打开预览"}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!row.sourceUrl}
                onSelect={() => row.sourceUrl && void open(row.sourceUrl)}
              >
                打开来源
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.inspect(row)}>
                查看完整信息
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  if (field === "title")
    return (
      <div className="article-news">
        <button
          role="link"
          className="article-news-title"
          title={row.title || ""}
          onClick={() => void open(articleUrl(actions.view, row.id))}
        >
          {row.title || "未命名文章"}
        </button>
        <div className="article-news-meta">
          <button
            role="link"
            title={`打开文章 ${row.id}`}
            onClick={() => void open(articleUrl(actions.view, row.id))}
          >
            {row.id}
          </button>
          <span>{row.className || "未分类"}</span>
          <span>{row.writer || "未署名"}</span>
          <span>{row.pages === null ? "分页未设置" : `${row.pages} 页`}</span>
          <time title={row.newsTime || ""}>
            {row.newsTime?.replace(
              /^\d{4}-(\d{2}-\d{2}) (\d{2}:\d{2}):\d{2}$/,
              "$1 $2",
            ) || "时间未设置"}
          </time>
        </div>
        {actions.showDistribution && <Distribution row={row} />}
      </div>
    );
  if (field === "titlePic")
    return (
      <div className="article-pictures">
        {(["titlePic", "titlePic2", "titlePic3"] as const).map((key, index) => {
          const url = articleImageUrl(row[key]);
          return (
            <MaterialImage
              key={key}
              density="thumbnail"
              url={url}
              label={`文章 ${row.id} 第 ${index + 1} 张图片`}
              onPreview={() => url && actions.onPreview(url)}
            />
          );
        })}
      </div>
    );
  if (field === "titlePic2" || field === "titlePic3") {
    const url = articleImageUrl(row[field]);
    return (
      <MaterialImage
        density="thumbnail"
        url={url}
        label={field === "titlePic2" ? "第二张图" : "第三张图"}
        onPreview={() => url && actions.onPreview(url)}
      />
    );
  }
  if (field === "id" || field === "sourceUrl")
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
  if (field === "comment") return <Distribution row={row} />;
  return <span className="break-words">{row[field] ?? "—"}</span>;
}
const columns: DataTableColumnDef<CmsArticleRow>[] = articleColumns.map(
  (config) => ({
    ...config,
    header: config.label,
    meta: { label: config.label },
    cell: ({ row }) => <Cell row={row.original} field={config.id} />,
  }),
);
// 响应式默认宽度属于列定义；仅将用户显式宽度放入 sizing，保留标题伸展。
const compactColumns = columns.map((column) => ({
  ...column,
  size:
    column.id === "title"
      ? 240
      : column.id === "titlePic"
        ? 176
        : column.id === "actions"
          ? 168
          : column.size,
}));
const pinnedEnd = ["actions"];
const pinnedSelect = ["reviewSelect"];
const getRowId = (row: CmsArticleRow) => String(row.id);
export function ArticleTable({
  rows,
  preferences,
  layout = "wide",
  ...actions
}: Actions & {
  rows: CmsArticleRow[];
  preferences: ColumnPreferencesController;
  layout?: Layout;
}) {
  const [inspection, setInspection] = useState<CmsArticleRow | null>(null);
  // 未配置的列采用紧凑布局；显式列宽与显隐仍然优先。
  const compact = layout !== "wide";
  const visibility: Record<string, boolean> = {
    ...preferences.visibility,
    comment:
      compact && preferences.preferences.visibility.comment === undefined
        ? false
        : preferences.visibility.comment,
  };
  const controller = {
    ...preferences,
    visibility: { ...visibility, reviewSelect: !!actions.review?.allowed },
  };
  const review = actions.review;
  const selectionColumns: DataTableColumnDef<CmsArticleRow>[] = review?.allowed
    ? [
        {
          id: "reviewSelect",
          size: 44,
          minSize: 44,
          maxSize: 44,
          enableHiding: false,
          meta: { label: "选择", resizable: false },
          header: () => (
            <Checkbox
              className="article-review-checkbox"
              aria-label="全选当前页文章"
              disabled={actions.busy || !rows.length}
              checked={
                rows.length > 0 &&
                rows.every((row) => review.selected.has(row.id))
                  ? true
                  : rows.some((row) => review.selected.has(row.id))
                    ? "indeterminate"
                    : false
              }
              onCheckedChange={(checked) =>
                checked ? review.selectAll(rows) : review.clearSelection()
              }
            />
          ),
          cell: ({ row }) => (
            <Checkbox
              className="article-review-checkbox"
              aria-label={`选择文章 ${row.original.id}`}
              disabled={actions.busy}
              checked={review.selected.has(row.original.id)}
              onCheckedChange={() => review.toggle(row.original.id)}
            />
          ),
        },
      ]
    : [];
  const table = useDataTable({
    data: rows,
    columns: [...selectionColumns, ...(compact ? compactColumns : columns)],
    preferences: controller,
    getRowId,
    pinnedEnd,
    pinnedStart: review?.allowed ? pinnedSelect : undefined,
  });
  const extras = articleColumns.filter(
    (column) =>
      visibility[column.id] &&
      !["title", "titlePic", "comment", "actions"].includes(column.id),
  );
  return (
    <Context
      value={{
        ...actions,
        compact,
        showDistribution: !visibility.comment || layout === "cards",
        inspect: setInspection,
      }}
    >
      {layout === "cards" ? (
        <div className="article-record-cards">
          {!rows.length && (
            <p role="status" className="p-8 text-center text-muted-foreground">
              暂无符合条件的文章
            </p>
          )}
          {rows.map((row) => (
            <Card
              key={row.id}
              className="gap-3 py-4 shadow-none"
              data-review-selected={
                (review?.allowed && review.selected.has(row.id)) || undefined
              }
            >
              <CardHeader>
                {review?.allowed && (
                  <Checkbox
                    aria-label={`选择文章 ${row.id}`}
                    disabled={actions.busy}
                    checked={review.selected.has(row.id)}
                    onCheckedChange={() => review.toggle(row.id)}
                  />
                )}
                <Cell row={row} field="title" />
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {visibility.titlePic && <Cell row={row} field="titlePic" />}
                {extras.map((column) => (
                  <div key={column.id}>
                    <span className="text-xs text-muted-foreground">
                      {column.label}：
                    </span>
                    <Cell row={row} field={column.id} />
                  </div>
                ))}
              </CardContent>
              <CardFooter className="justify-end">
                <Cell row={row} field="actions" />
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <DataTable
          table={table}
          aria-label="CMS 文章列表"
          externalScroll
          density="compact"
          stretchColumnId="title"
          getRowProps={(row) => ({
            "aria-selected": review?.allowed
              ? review.selected.has(row.original.id)
              : undefined,
            className: review?.selected.has(row.original.id)
              ? "article-review-selected"
              : undefined,
          })}
          resizeDisabled={actions.busy}
          emptyMessage="暂无符合条件的文章"
        />
      )}
      <Dialog
        open={!!inspection}
        onOpenChange={(open) => !open && setInspection(null)}
      >
        <DialogContent className="article-details">
          <DialogTitle>文章完整信息 · {inspection?.id}</DialogTitle>
          <DialogDescription>
            核对列表字段；正文与可编辑信息请进入文章编辑。
          </DialogDescription>
          {inspection && (
            <div className="min-h-0 overflow-auto">
              <dl className="article-details-fields">
                {articleColumns
                  .filter(
                    (column) =>
                      ![
                        "actions",
                        "titlePic",
                        "titlePic2",
                        "titlePic3",
                      ].includes(column.id),
                  )
                  .map((column) => (
                    <div key={column.id}>
                      <dt>{column.label}</dt>
                      <dd>
                        {column.id === "title" ? (
                          inspection.title || "未命名文章"
                        ) : column.id === "comment" ? (
                          <div className="flex flex-col gap-2">
                            <p>推荐：{inspection.commentRecommand || "无"}</p>
                            {inspection.commentPromote.length ? (
                              <ul className="flex flex-col gap-1">
                                {inspection.commentPromote.map(
                                  (value, index) => (
                                    <li key={index}>{value}</li>
                                  ),
                                )}
                              </ul>
                            ) : (
                              <p>暂无分发记录</p>
                            )}
                          </div>
                        ) : (
                          <Cell row={inspection} field={column.id} />
                        )}
                      </dd>
                    </div>
                  ))}
                <div>
                  <dt>摘要</dt>
                  <dd>{inspection.smallText || "—"}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-3">
                {(["titlePic", "titlePic2", "titlePic3"] as const).map(
                  (field, index) => (
                    <MaterialImage
                      compact
                      key={field}
                      url={articleImageUrl(inspection[field])}
                      label={`文章图片 ${index + 1}`}
                      onPreview={() => {
                        const url = articleImageUrl(inspection[field]);
                        if (url) actions.onPreview(url);
                      }}
                    />
                  ),
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Context>
  );
}
