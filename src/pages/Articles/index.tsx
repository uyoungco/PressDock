import { useEffect, useMemo, useRef, useState } from "react";
import { isAndroid, isDemo } from "@/lib/platform";
import MobileArticles from "./MobileArticles";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Navigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DataTableColumnSettings } from "@/components/ui/data-table-column-settings";
import { useColumnPreferences } from "@/hooks/use-column-preferences";
import { MaterialImage } from "@/features/channels/MaterialImage";
import { ArticleTable } from "@/features/cms-articles/ArticleTable";
import { useAtomValue, useSetAtom } from "jotai";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBusinessQuery, useQueryUser } from "@/hooks/use-business-query";
import { articleFiltersAtom, businessKeys } from "@/lib/query-runtime";
import {
  articleColumns,
  articleQueryParams,
  articleService,
  defaultQuery,
  readArticleQuery,
} from "@/features/cms-articles/service";
import { ArticleFilters } from "@/features/cms-articles/ArticleFilters";
import { useArticleLayout } from "@/features/cms-articles/use-article-layout";
import { useArticleActions } from "@/features/cms-articles/use-article-actions";
import {
  articlePageSizes,
  cmsArticleQuerySchema,
  type ArticleView,
  type CmsArticleQuery,
} from "@/types/cms-article";

export default function Articles({ view }: { view: ArticleView }) {
  const [params] = useSearchParams();
  const remembered = useAtomValue(articleFiltersAtom)[view];
  // 原生演示不具备文章接口；浏览器验收使用独立注入的内存替身。
  if (isAndroid() && isDemo())
    return (
      <Alert>
        <AlertTitle>演示版暂不支持文章管理</AlertTitle>
        <AlertDescription>
          演示包仅提供本机渠道素材和图片，不连接 CMS。
        </AlertDescription>
      </Alert>
    );
  if (!params.size)
    return (
      <Navigate
        replace
        to={{
          pathname: `/articles/${view}`,
          search: `?${articleQueryParams(remembered ?? defaultQuery(view))}`,
        }}
      />
    );
  // 切换类别时重新挂载，避免表单、请求结果和分页在不同审核级别间串用。
  return isAndroid() ? (
    <MobileArticles key={view} view={view} />
  ) : (
    <ArticleResults key={view} view={view} />
  );
}
function ArticleResults({ view }: { view: ArticleView }) {
  const [params, setParams] = useSearchParams();
  const applied = useMemo(() => readArticleQuery(view, params), [view, params]);
  const [draft, setDraft] = useState(applied);
  const user = useQueryUser();
  const remember = useSetAtom(articleFiltersAtom);
  const classQuery = useBusinessQuery(
    businessKeys.classes(user),
    articleService.classes,
  );
  const classes = classQuery.data ?? [];
  const classesError = classQuery.error?.message ?? null;
  const list = useBusinessQuery(businessKeys.articlePage(user, applied), () =>
    articleService.list(applied),
  );
  const page = list.data ?? null;
  const loading = list.isPending;
  const error = list.error?.message ?? null;
  const [filterError, setFilterError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const preferences = useColumnPreferences(
    `cms-articles-${view}`,
    articleColumns,
  );
  const refresh = () => {
    void list.refetch();
  };
  const actions = useArticleActions(view, classes, classesError, () => {
    void classQuery.refetch();
  });
  const key = articleQueryParams(applied).toString();
  useEffect(() => {
    setDraft(applied);
    remember((previous) => ({ ...previous, [view]: applied }));
    if (viewport.current) viewport.current.scrollTop = 0;
  }, [applied, remember, view]);
  function submit(query: CmsArticleQuery) {
    const parsed = cmsArticleQuerySchema.safeParse(query);
    if (!parsed.success) {
      setFilterError(
        parsed.error.issues.map((issue) => issue.message).join("；"),
      );
      return;
    }
    setFilterError(null);
    if (articleQueryParams(query).toString() === key) refresh();
    else setParams(articleQueryParams(query));
  }
  const { ref: workspace, layout } = useArticleLayout();
  const totalPages = page
    ? Math.max(1, Math.ceil(page.total / applied.pagesize))
    : applied.current;
  return (
    <>
      <header className="article-page-heading">
        <h1>
          {
            {
              quality: "优质文章",
              "review-1": "一级待审核文章",
              "review-2": "二级待审核文章",
              "review-3": "三级待审核文章",
            }[view]
          }
        </h1>
        <p>核对标题、配图与分页，继续编辑文章</p>
      </header>
      <Card
        ref={workspace}
        data-layout={layout}
        className="articles-workspace h-full min-h-0 min-w-0 flex-1 gap-0 overflow-hidden py-0 shadow-none"
      >
        <ArticleFilters
          view={view}
          draft={draft}
          onChange={setDraft}
          onSubmit={() =>
            submit({ ...draft, current: 1, pagesize: applied.pagesize })
          }
          onReset={() => {
            const query = { ...defaultQuery(view), pagesize: applied.pagesize };
            setDraft(query);
            submit(query);
          }}
          locked={actions.busy}
          classes={classes}
          classesError={classesError}
          retryClasses={() => void classQuery.refetch()}
          error={filterError}
        />
        {/* 与渠道素材页一致，列配置紧邻表格，并保留在列表滚动区域外。 */}
        <div className="article-list-toolbar flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
          <span className="mr-auto text-xs text-muted-foreground">
            {page ? `${page.total} 篇文章` : "文章记录"}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={actions.busy || list.isFetching}
            onClick={refresh}
            aria-label="刷新文章列表"
            aria-busy={list.isFetching}
          >
            <RefreshCw
              data-icon="inline-start"
              className={cn(list.isFetching && "animate-spin")}
            />
            刷新
          </Button>
          <div className="ml-auto">
            <DataTableColumnSettings
              controller={preferences}
              disabled={actions.busy}
            />
          </div>
        </div>
        <ScrollArea
          viewportRef={viewport}
          orientation="both"
          className="flex-1"
          viewportProps={{
            role: "region",
            "aria-label": "文章列表内容",
            tabIndex: 0,
            className: "overscroll-contain",
          }}
        >
          {loading ? (
            <div className="flex flex-col gap-3 p-4" aria-label="正在加载文章">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : null}
          {error && (
            <div role="alert" className="flex flex-col gap-3 p-6">
              <p className="text-destructive">{error}</p>
              <Button variant="outline" onClick={refresh}>
                重试文章列表
              </Button>
            </div>
          )}
          {page && (
            <ArticleTable
              rows={page.data}
              layout={layout}
              preferences={preferences}
              view={view}
              busy={actions.busy}
              onEdit={(row) => void actions.beginEdit(row)}
              onPromote={actions.beginPromote}
              onPreview={setPreview}
            />
          )}
        </ScrollArea>
        <div
          aria-label="文章分页"
          className="flex shrink-0 flex-wrap items-center gap-3 border-t px-4 py-2 text-xs text-muted-foreground"
        >
          <span>
            第 {applied.current} / {totalPages} 页
            {page && ` · 共 ${page.total} 条`}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label htmlFor="article-page-size">每页条数</label>
            <Select<number>
              value={applied.pagesize}
              items={articlePageSizes.map((value) => ({
                value,
                label: String(value),
              }))}
              disabled={actions.busy}
              onValueChange={(value) => {
                if (value !== null)
                  submit({
                    ...applied,
                    current: 1,
                    pagesize: value as CmsArticleQuery["pagesize"],
                  });
              }}
            >
              <SelectTrigger id="article-page-size" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {articlePageSizes.map((size) => (
                    <SelectItem key={size} value={size}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              disabled={actions.busy || loading || applied.current <= 1}
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
                actions.busy ||
                loading ||
                !!error ||
                !page ||
                applied.current >= totalPages
              }
              onClick={() =>
                submit({ ...applied, current: applied.current + 1 })
              }
            >
              下一页
            </Button>
          </div>
        </div>
      </Card>
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent className="article-image-dialog">
          <DialogTitle>文章图片</DialogTitle>
          <DialogDescription>查看原图</DialogDescription>
          {preview && <MaterialImage url={preview} label="文章图片预览" />}
        </DialogContent>
      </Dialog>
      {actions.dialogs}
    </>
  );
}
