import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSetAtom } from "jotai";
import { toast } from "sonner";
import { RefreshCw, SlidersHorizontal, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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
  DialogHeader,
  DialogFooter,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/common/SearchableSelect";
import { MaterialImage } from "@/features/channels/MaterialImage";
import { useBusinessQuery, useQueryUser } from "@/hooks/use-business-query";
import { articleFiltersAtom, businessKeys } from "@/lib/query-runtime";
import {
  articleQueryParams,
  articleService,
  articleImageUrl,
  articleUrl,
  defaultQuery,
  readArticleQuery,
} from "@/features/cms-articles/service";
import { articleMemory } from "@/features/cms-articles/state";
import { useArticleActions } from "@/features/cms-articles/use-article-actions";
import {
  articlePageSizes,
  cmsArticleQuerySchema,
  type ArticleView,
  type CmsArticleQuery,
  type CmsArticleRow,
} from "@/types/cms-article";

export default function MobileArticles({ view }: { view: ArticleView }) {
  const [params, setParams] = useSearchParams();
  const applied = useMemo(() => readArticleQuery(view, params), [view, params]);
  const key = articleQueryParams(applied).toString();
  const remembered = articleMemory.mobileList(view);
  const [draft, setDraft] = useState(() =>
    remembered?.key === key ? remembered.draft : applied,
  );
  const scrollTop = useRef(remembered?.key === key ? remembered.scrollTop : 0);
  const previousKey = useRef(key);
  const viewport = useRef<HTMLDivElement>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterContainer, setFilterContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const [filterError, setFilterError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
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
  const refresh = () => {
    void list.refetch();
  };
  const actions = useArticleActions(view, classes, classesError, () => {
    void classQuery.refetch();
  });
  const authorVisible = view === "quality" || view === "review-1";
  const totalPages = page
    ? Math.max(1, Math.ceil(page.total / applied.pagesize))
    : applied.current;
  // 已提交查询、筛选输入与列表位置分别记忆；只有查询变化才重置位置。
  useEffect(() => {
    remember((previous) => ({ ...previous, [view]: applied }));
    if (previousKey.current !== key) {
      previousKey.current = key;
      scrollTop.current = 0;
      setDraft(applied);
    }
  }, [applied, key, remember, view]);
  useEffect(() => {
    if (page && viewport.current)
      viewport.current.scrollTop = scrollTop.current;
  }, [page]);
  useEffect(() => {
    articleMemory.saveMobileList(view, {
      draft,
      key,
      scrollTop: scrollTop.current,
    });
  }, [draft, key, view]);
  function submit(query: CmsArticleQuery) {
    const parsed = cmsArticleQuerySchema.safeParse(query);
    if (!parsed.success) {
      setFilterError(
        parsed.error.issues.map((issue) => issue.message).join("；"),
      );
      return;
    }
    setFilterError(null);
    setFilterOpen(false);
    if (articleQueryParams(query).toString() === key) refresh();
    else setParams(articleQueryParams(query));
  }
  return (
    <section
      data-mobile-articles
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-2"
    >
      <header className="flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          disabled={actions.busy}
          onClick={() => setFilterOpen(true)}
        >
          <SlidersHorizontal data-icon="inline-start" />
          筛选
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {applied.title || "全部文章"}
        </p>
        <Button
          variant="outline"
          aria-label="刷新文章列表"
          disabled={actions.busy || list.isFetching}
          onClick={refresh}
        >
          <RefreshCw data-icon="inline-start" />
          刷新
        </Button>
      </header>
      {actions.savedDraft && (
        <Alert>
          <AlertTitle>
            有未保存的{actions.savedDraft.kind === "edit" ? "文章" : "转素材"}
            草稿
          </AlertTitle>
          <AlertDescription>
            <p>仅在本次运行中保留。</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={actions.busy} onClick={actions.restoreDraft}>
                继续编辑
              </Button>
              <Button
                variant="outline"
                disabled={actions.busy}
                onClick={actions.discardDraft}
              >
                放弃草稿
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      <ScrollArea
        className="flex-1"
        viewportRef={viewport}
        viewportProps={{
          role: "region",
          "aria-label": "文章列表内容",
          className: "overscroll-contain",
          onScroll: (event) => {
            scrollTop.current = event.currentTarget.scrollTop;
            articleMemory.saveMobileList(view, {
              draft,
              key,
              scrollTop: scrollTop.current,
            });
          },
        }}
      >
        <div className="flex min-w-0 flex-col gap-3 pb-2">
          {loading && (
            <div aria-label="正在加载文章" className="flex flex-col gap-3">
              <Skeleton className="h-44" />
              <Skeleton className="h-44" />
            </div>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertTitle>文章加载失败</AlertTitle>
              <AlertDescription>
                <p>{error}</p>
                <Button variant="outline" onClick={refresh}>
                  重试文章列表
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {page?.data.map((row) => (
            <ArticleCard
              key={row.id}
              row={row}
              view={view}
              busy={actions.busy}
              onEdit={() => void actions.beginEdit(row)}
              onPromote={() => actions.beginPromote(row)}
              onPreview={setPreview}
            />
          ))}
          {page && !page.data.length && (
            <p role="status" className="p-6 text-center text-muted-foreground">
              暂无符合条件的文章
            </p>
          )}
        </div>
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
            onClick={() => submit({ ...applied, current: applied.current - 1 })}
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
            onClick={() => submit({ ...applied, current: applied.current + 1 })}
          >
            下一页
          </Button>
        </div>
      </div>

      <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
        <DialogContent
          ref={setFilterContainer}
          data-article-dialog="filter"
          showCloseButton={false}
        >
          <DialogHeader>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                aria-label="返回文章列表"
                onClick={() => setFilterOpen(false)}
              >
                <ArrowLeft />
              </Button>
              <DialogTitle>筛选文章</DialogTitle>
            </div>
            <DialogDescription>
              搜索后应用条件；返回会保留尚未提交的输入。
            </DialogDescription>
          </DialogHeader>
          <ScrollArea
            className="flex-1"
            viewportProps={{ className: "overscroll-contain px-1" }}
          >
            <form
              id="mobile-article-filter"
              aria-label="文章筛选"
              onSubmit={(event) => {
                event.preventDefault();
                submit({ ...draft, current: 1, pagesize: applied.pagesize });
              }}
            >
              <fieldset disabled={actions.busy}>
                <FieldGroup className="grid grid-cols-2 items-end gap-3 ">
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
                      portalContainer={filterContainer}
                      id="article-class"
                      value={
                        draft.classid === null ? "" : String(draft.classid)
                      }
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
                    onClick={() => void classQuery.refetch()}
                  >
                    重试分类
                  </Button>
                </div>
              )}
            </form>
          </ScrollArea>
          <DialogFooter>
            <Button
              variant="outline"
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
            <Button type="submit" form="mobile-article-filter">
              搜索
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent data-article-dialog="image">
          <DialogTitle>文章图片</DialogTitle>
          <DialogDescription>查看原图</DialogDescription>
          <ScrollArea className="flex-1">
            {preview && <MaterialImage url={preview} label="文章图片预览" />}
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {actions.dialogs}
    </section>
  );
}

function ArticleCard({
  row,
  view,
  busy,
  onEdit,
  onPromote,
  onPreview,
}: {
  row: CmsArticleRow;
  view: ArticleView;
  busy: boolean;
  onEdit: () => void;
  onPromote: () => void;
  onPreview: (url: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  async function open(url: string) {
    try {
      await articleService.openLink(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "打开链接失败");
    }
  }
  return (
    <Card className="min-w-0 gap-3 py-3">
      <CardHeader className="gap-2 px-3">
        <CardTitle>
          <button
            className="w-full text-left leading-relaxed break-words text-primary"
            onClick={() => void open(articleUrl(view, row.id))}
          >
            {row.title || "无标题文章"}
          </button>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          #{row.id} · {row.className || "未分类"}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-3">
        <div className="flex min-w-0 gap-3">
          <MaterialImage
            compact
            url={articleImageUrl(row.titlePic)}
            label={`文章 ${row.id} 主图`}
            onPreview={() => {
              const url = articleImageUrl(row.titlePic);
              if (url) onPreview(url);
            }}
          />
          <dl className="flex min-w-0 flex-1 flex-col gap-1 text-sm break-words">
            <div>
              <dt className="inline text-muted-foreground">作者：</dt>
              <dd className="inline">{row.writer || "—"}</dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">时间：</dt>
              <dd className="inline">{row.newsTime || "—"}</dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">页数：</dt>
              <dd className="inline">{row.pages ?? "—"}</dd>
            </div>
          </dl>
        </div>
        {expanded && (
          <div className="flex min-w-0 flex-col gap-3 text-sm break-words">
            <p>{row.smallText || "暂无摘要"}</p>
            <div className="flex flex-wrap gap-3">
              {[row.titlePic2, row.titlePic3].map((image, i) => (
                <MaterialImage
                  key={i}
                  compact
                  url={articleImageUrl(image)}
                  label={`文章 ${row.id} 图片 ${i + 2}`}
                  onPreview={() => {
                    const url = articleImageUrl(image);
                    if (url) onPreview(url);
                  }}
                />
              ))}
            </div>
            {(["tags", "nTags"] as const).map((field) => (
              <div key={field}>
                <p className="mb-1 text-muted-foreground">
                  {field === "tags" ? "标签" : "NTags"}
                </p>
                <div className="flex flex-wrap gap-1">
                  {row[field].map((tag, i) => (
                    <Badge key={i} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                  {!row[field].length && "—"}
                </div>
              </div>
            ))}
            <div>
              <p className="text-muted-foreground">推荐信息</p>
              <p>{row.commentRecommand || "—"}</p>
              {row.commentPromote.map((comment, i) => (
                <p key={i}>{comment}</p>
              ))}
            </div>
            <Button
              variant="link"
              className="h-auto justify-start whitespace-normal p-0 text-left break-all"
              disabled={!row.sourceUrl}
              onClick={() => void open(row.sourceUrl!)}
            >
              {row.sourceUrl || "无来源链接"}
            </Button>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 px-3">
        <Button variant="outline" disabled={busy} onClick={onEdit}>
          编辑
        </Button>
        {view === "quality" && (
          <Button variant="outline" disabled={busy} onClick={onPromote}>
            添加到渠道素材
          </Button>
        )}
        <Button
          variant="ghost"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起" : "更多信息"}
        </Button>
      </CardFooter>
    </Card>
  );
}
