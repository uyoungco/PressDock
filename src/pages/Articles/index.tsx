import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
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
import { SearchableSelect } from "@/components/common/SearchableSelect";
import { useColumnPreferences } from "@/hooks/use-column-preferences";
import { MaterialImage } from "@/features/channels/MaterialImage";
import { ArticleTable } from "@/features/cms-articles/ArticleTable";
import { articleMemory } from "@/features/cms-articles/state";
import {
  articleColumns,
  articleQueryParams,
  articleService,
  defaultQuery,
  readArticleQuery,
} from "@/features/cms-articles/service";
import { useArticleActions } from "@/features/cms-articles/use-article-actions";
import {
  articlePageSizes,
  cmsArticleQuerySchema,
  type ArticleClass,
  type ArticleView,
  type CmsArticlePage,
  type CmsArticleQuery,
} from "@/types/cms-article";

export default function Articles({ view }: { view: ArticleView }) {
  const [params] = useSearchParams();
  if (!params.size)
    return (
      <Navigate
        replace
        to={{
          pathname: `/articles/${view}`,
          search: `?${articleQueryParams(articleMemory.query(view) ?? defaultQuery(view))}`,
        }}
      />
    );
  // 切换类别时重新挂载，避免表单、请求结果和分页在不同审核级别间串用。
  return <ArticleResults key={view} view={view} />;
}
function ArticleResults({ view }: { view: ArticleView }) {
  const [params, setParams] = useSearchParams();
  const applied = useMemo(() => readArticleQuery(view, params), [view, params]);
  const [draft, setDraft] = useState(applied);
  const [classes, setClasses] = useState<ArticleClass[]>([]);
  const [classesError, setClassesError] = useState<string | null>(null);
  const [classRetry, setClassRetry] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    page: CmsArticlePage;
  } | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0),
    [preview, setPreview] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const preferences = useColumnPreferences(
    `cms-articles-${view}`,
    articleColumns,
  );
  const refresh = () => setRetry((value) => value + 1);
  const actions = useArticleActions(
    view,
    classes,
    classesError,
    () => setClassRetry((value) => value + 1),
    refresh,
  );
  const key = articleQueryParams(applied).toString();
  const page = result?.key === key ? result.page : null;
  useEffect(() => {
    setDraft(applied);
    articleMemory.remember(applied);
  }, [applied]);
  useEffect(() => {
    let active = true;
    setClassesError(null);
    articleService
      .classes()
      .then((value) => {
        if (active) setClasses(value);
      })
      .catch((reason: unknown) => {
        if (active)
          setClassesError(
            reason instanceof Error ? reason.message : "读取分类失败",
          );
      });
    return () => {
      active = false;
    };
  }, [classRetry]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    articleService
      .list(applied)
      .then((page) => {
        if (active) {
          setResult({ key, page });
          if (viewport.current) viewport.current.scrollTop = 0;
        }
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : "读取文章失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applied, key, retry]);
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
  const authorVisible = view === "quality" || view === "review-1";
  const totalPages = page
    ? Math.max(1, Math.ceil(page.total / applied.pagesize))
    : applied.current;
  return (
    <>
      <Card className="h-full min-h-0 min-w-0 flex-1 gap-0 overflow-hidden py-0 shadow-none">
        <form
          aria-label="文章筛选"
          className="shrink-0 border-b p-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit({ ...draft, current: 1, pagesize: applied.pagesize });
          }}
        >
          <fieldset disabled={actions.busy}>
            <FieldGroup className="grid grid-cols-2 items-end gap-3 md:grid-cols-4 xl:grid-cols-6">
              <Field>
                <FieldLabel htmlFor="article-id">ID</FieldLabel>
                <Input
                  id="article-id"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={draft.id ?? ""}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      id: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="article-class">分类</FieldLabel>
                <SearchableSelect
                  id="article-class"
                  value={draft.classid === null ? "" : String(draft.classid)}
                  disabled={!!classesError || !classes.length}
                  options={[
                    { value: "", label: "全部分类" },
                    ...classes.map((value) => ({
                      value: String(value.id),
                      label: value.name,
                    })),
                  ]}
                  onValueChange={(value) =>
                    setDraft({
                      ...draft,
                      classid: value ? Number(value) : null,
                    })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="article-title">标题</FieldLabel>
                <Input
                  id="article-title"
                  value={draft.title}
                  onChange={(event) =>
                    setDraft({ ...draft, title: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="article-start">开始日期</FieldLabel>
                <Input
                  id="article-start"
                  type="date"
                  value={draft.start}
                  onChange={(event) =>
                    setDraft({ ...draft, start: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="article-end">结束日期</FieldLabel>
                <Input
                  id="article-end"
                  type="date"
                  value={draft.end}
                  onChange={(event) =>
                    setDraft({ ...draft, end: event.target.value })
                  }
                />
              </Field>
              {authorVisible && (
                <Field>
                  <FieldLabel htmlFor="article-author">作者</FieldLabel>
                  <Input
                    id="article-author"
                    value={draft.author}
                    onChange={(event) =>
                      setDraft({ ...draft, author: event.target.value })
                    }
                  />
                </Field>
              )}
              <div className="col-span-2 flex flex-wrap items-center gap-4">
                {authorVisible && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.editor}
                      onChange={(event) =>
                        setDraft({ ...draft, editor: event.target.checked })
                      }
                    />
                    editor
                  </label>
                )}
                {view === "quality" && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.nubia}
                      onChange={(event) =>
                        setDraft({ ...draft, nubia: event.target.checked })
                      }
                    />
                    努比亚
                  </label>
                )}
                <Button type="submit" size="sm">
                  搜索
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const query = {
                      ...defaultQuery(view),
                      pagesize: applied.pagesize,
                    };
                    setDraft(query);
                    submit(query);
                  }}
                >
                  重置
                </Button>
              </div>
            </FieldGroup>
          </fieldset>
          {filterError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {filterError}
            </p>
          )}
          {classesError && (
            <div
              role="alert"
              className="mt-2 flex items-center gap-2 text-sm text-destructive"
            >
              分类加载失败：{classesError}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setClassRetry((v) => v + 1)}
              >
                重试分类
              </Button>
            </div>
          )}
        </form>
        {/* 与渠道素材页一致，列配置紧邻表格，并保留在列表滚动区域外。 */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 md:gap-3 md:px-4">
          <div className="ml-auto">
            <DataTableColumnSettings
              controller={preferences}
              disabled={actions.busy}
            />
          </div>
        </div>
        <div
          ref={viewport}
          role="region"
          aria-label="文章列表内容"
          tabIndex={0}
          className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain [scrollbar-gutter:stable]"
        >
          {loading ? (
            <div className="space-y-3 p-4" aria-label="正在加载文章">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : error ? (
            <div role="alert" className="space-y-3 p-6">
              <p className="text-destructive">{error}</p>
              <Button variant="outline" onClick={refresh}>
                重试文章列表
              </Button>
            </div>
          ) : (
            page && (
              <ArticleTable
                rows={page.data}
                preferences={preferences}
                view={view}
                busy={actions.busy}
                onEdit={(row) => void actions.beginEdit(row)}
                onPromote={actions.beginPromote}
                onPreview={setPreview}
              />
            )
          )}
        </div>
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
        <DialogContent className="sm:max-w-3xl">
          <DialogTitle>文章图片</DialogTitle>
          <DialogDescription>查看原图</DialogDescription>
          {preview && <MaterialImage url={preview} label="文章图片预览" />}
        </DialogContent>
      </Dialog>
      {actions.dialogs}
    </>
  );
}
