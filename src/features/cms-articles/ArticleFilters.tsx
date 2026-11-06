import { useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { SearchableSelect } from "@/components/common/SearchableSelect";
import type {
  ArticleClass,
  ArticleView,
  CmsArticleQuery,
} from "@/types/cms-article";

export function ArticleFilters({
  view,
  draft,
  onChange,
  onSubmit,
  onReset,
  locked,
  classes,
  classesError,
  retryClasses,
  error,
}: {
  view: ArticleView;
  draft: CmsArticleQuery;
  onChange: (query: CmsArticleQuery) => void;
  onSubmit: () => void;
  onReset: () => void;
  locked: boolean;
  classes: ArticleClass[];
  classesError: string | null;
  retryClasses: () => void;
  error: string | null;
}) {
  const [expanded, setExpanded] = useState(
    !!(draft.id || draft.author || draft.editor || draft.nubia),
  );
  const authorVisible = view === "quality" || view === "review-1";
  const count =
    Number(!!draft.id) +
    Number(!!draft.author) +
    Number(draft.editor) +
    Number(draft.nubia);
  return (
    <form
      aria-label="文章筛选"
      className="article-filters"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <fieldset disabled={locked}>
        <FieldGroup className="article-filter-primary">
          <Field className="article-filter-title">
            <FieldLabel htmlFor="article-title" className="sr-only">
              标题
            </FieldLabel>
            <Input
              id="article-title"
              placeholder="搜索文章标题"
              value={draft.title}
              onChange={(event) =>
                onChange({ ...draft, title: event.target.value })
              }
            />
          </Field>
          <Field className="article-filter-class">
            <FieldLabel htmlFor="article-class" className="sr-only">
              分类
            </FieldLabel>
            <SearchableSelect
              id="article-class"
              value={draft.classid === null ? "" : String(draft.classid)}
              disabled={locked || !!classesError || !classes.length}
              options={[
                { value: "", label: "全部分类" },
                ...classes.map((item) => ({
                  value: String(item.id),
                  label: item.name,
                })),
              ]}
              onValueChange={(value) =>
                onChange({ ...draft, classid: value ? Number(value) : null })
              }
            />
          </Field>
          <Field className="article-filter-date">
            <FieldLabel htmlFor="article-start" className="sr-only">
              开始日期
            </FieldLabel>
            <Input
              id="article-start"
              type="date"
              value={draft.start}
              onChange={(event) =>
                onChange({ ...draft, start: event.target.value })
              }
            />
          </Field>
          <span className="text-xs text-muted-foreground">至</span>
          <Field className="article-filter-date">
            <FieldLabel htmlFor="article-end" className="sr-only">
              结束日期
            </FieldLabel>
            <Input
              id="article-end"
              type="date"
              value={draft.end}
              onChange={(event) =>
                onChange({ ...draft, end: event.target.value })
              }
            />
          </Field>
          <Button type="submit" size="sm">
            <Search data-icon="inline-start" />
            搜索
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onReset}>
            重置
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={expanded}
            aria-controls="article-extra-filters"
            onClick={() => setExpanded(!expanded)}
          >
            更多筛选{count ? `（${count}）` : ""}
            <ChevronDown data-icon="inline-end" />
          </Button>
        </FieldGroup>
        <FieldGroup
          id="article-extra-filters"
          hidden={!expanded}
          className="article-filter-extra"
        >
          <Field>
            <FieldLabel htmlFor="article-id">文章编号</FieldLabel>
            <Input
              id="article-id"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={draft.id ?? ""}
              onChange={(event) =>
                onChange({
                  ...draft,
                  id: event.target.value ? Number(event.target.value) : null,
                })
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
                  onChange({ ...draft, author: event.target.value })
                }
              />
            </Field>
          )}
          {authorVisible && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.editor}
                onChange={(event) =>
                  onChange({ ...draft, editor: event.target.checked })
                }
              />
              editor
            </label>
          )}
          {view === "quality" && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.nubia}
                onChange={(event) =>
                  onChange({ ...draft, nubia: event.target.checked })
                }
              />
              努比亚
            </label>
          )}
        </FieldGroup>
      </fieldset>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
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
            onClick={retryClasses}
          >
            重试分类
          </Button>
        </div>
      )}
    </form>
  );
}
