import type {
  ArticleView,
  ArticleUpdate,
  CmsArticleDetail,
  CmsArticleQuery,
  CmsArticleRow,
} from "@/types/cms-article";
import type { PromoteInput } from "@/types/cms";
import { articleInput } from "./service";
export type ArticleEdit =
  | { kind: "edit"; base: CmsArticleDetail; input: ArticleUpdate }
  | { kind: "promote"; article: CmsArticleRow; input: PromoteInput };
const queries = new Map<ArticleView, CmsArticleQuery>();
const buffers = new Map<ArticleView, ArticleEdit>();
let owner: number | null = null;
// 只存运行内存：失效后同账号可恢复，显式退出或换号清空正文及查询。
export const articleMemory = {
  query: (view: ArticleView) => queries.get(view),
  remember: (query: CmsArticleQuery) => queries.set(query.view, { ...query }),
  edit: (view: ArticleView) => buffers.get(view) ?? null,
  saveEdit: (view: ArticleView, edit: ArticleEdit) =>
    buffers.set(view, structuredClone(edit)),
  removeEdit: (view: ArticleView) => buffers.delete(view),
  clear() {
    queries.clear();
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
