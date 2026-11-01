import type {
  ArticleView,
  ArticleUpdate,
  CmsArticleDetail,
  CmsArticleQuery,
  CmsArticleRow,
} from "@/types/cms-article";
import type { PromoteInput } from "@/types/cms";
import { articleInput } from "./service";
import { appQueryRuntime, articleFiltersAtom } from "@/lib/query-runtime";
export type ArticleEdit =
  | { kind: "edit"; base: CmsArticleDetail; input: ArticleUpdate }
  | { kind: "promote"; article: CmsArticleRow; input: PromoteInput };
const buffers = new Map<ArticleView, ArticleEdit>();
let owner: number | null = null;
// 只存运行内存：失效后同账号可恢复，显式退出或换号清空正文及查询。
export const articleMemory = {
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
