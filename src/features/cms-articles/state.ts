import type {
  ArticleView,
  ArticleUpdate,
  CmsArticleDetail,
  CmsArticleQuery,
  CmsArticleRow,
  ArticleReviewSummary,
} from "@/types/cms-article";
import type { PromoteInput } from "@/types/cms";
import { articleInput } from "./service";
import { appQueryRuntime, articleFiltersAtom } from "@/lib/query-runtime";
export type ArticleEdit =
  | { kind: "edit"; base: CmsArticleDetail; input: ArticleUpdate }
  | { kind: "promote"; article: CmsArticleRow; input: PromoteInput };
const buffers = new Map<ArticleView, ArticleEdit>();
const reviewResults = new Map<ArticleView, ArticleReviewSummary>();
const reviewChecks = new Map<ArticleView, Set<number>>();
// 手机查询草稿、列表位置与编辑草稿同属当前账号的运行内存。
const mobileLists = new Map<
  ArticleView,
  { draft: CmsArticleQuery; key: string; scrollTop: number }
>();
let owner: number | null = null;
// 只存运行内存：失效后同账号可恢复，显式退出或换号清空正文及查询。
export const articleMemory = {
  reviewResult: (view: ArticleView) => reviewResults.get(view) ?? null,
  saveReviewResult: (view: ArticleView, value: ArticleReviewSummary | null) => {
    if (value) {
      reviewResults.set(view, structuredClone(value));
      const pending = reviewChecks.get(view) ?? new Set<number>();
      value.items
        .filter((item) => item.status === "unconfirmed")
        .forEach((item) => pending.add(item.id));
      reviewChecks.set(view, pending);
    } else reviewResults.delete(view);
  },
  reviewNeedsRefresh: (view: ArticleView, ids: number[]) =>
    ids.some((id) => reviewChecks.get(view)?.has(id)),
  confirmReviewRefresh: (view: ArticleView) => reviewChecks.delete(view),
  dirtyFor: (ids: number[]) =>
    [...buffers.entries()].find(
      ([, edit]) =>
        ids.includes(edit.kind === "edit" ? edit.base.id : edit.article.id) &&
        articleEditIsDirty(edit),
    ),
  mobileList: (view: ArticleView) => mobileLists.get(view),
  saveMobileList: (
    view: ArticleView,
    value: { draft: CmsArticleQuery; key: string; scrollTop: number },
  ) => mobileLists.set(view, value),
  query: (view: ArticleView) =>
    appQueryRuntime.store.get(articleFiltersAtom)[view],
  remember: (query: CmsArticleQuery) =>
    appQueryRuntime.store.set(articleFiltersAtom, (previous) => ({
      ...previous,
      [query.view]: { ...query },
    })),
  edit: (view: ArticleView) => buffers.get(view) ?? null,
  saveEdit: (view: ArticleView, edit: ArticleEdit) =>
    buffers.set(view, structuredClone(edit)),
  removeEdit: (view: ArticleView) => buffers.delete(view),
  clear() {
    appQueryRuntime.store.set(articleFiltersAtom, {});
    buffers.clear();
    reviewResults.clear();
    reviewChecks.clear();
    mobileLists.clear();
    owner = null;
  },
  retainUser(user: number) {
    if (owner !== null && owner !== user) this.clear();
    owner = user;
  },
};
export function articleEditIsDirty(edit: ArticleEdit | null) {
  return (
    !!edit &&
    (edit.kind === "promote" ||
      JSON.stringify(edit.input) !== JSON.stringify(articleInput(edit.base)))
  );
}
