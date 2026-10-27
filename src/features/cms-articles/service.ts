import { articleIpc } from "@/services/tauri/articles";
import { channelService } from "@/features/channels/service";
import {
  cmsArticleQuerySchema,
  type ArticleView,
  type CmsArticleQuery,
  type CmsArticleDetail,
  type ArticleUpdate,
} from "@/types/cms-article";

export const articleService = {
  ...articleIpc,
  upload: channelService.upload,
  openLink: channelService.openLink,
};
export const defaultQuery = (view: ArticleView): CmsArticleQuery => ({
  view,
  id: null,
  classid: null,
  title: "",
  start: "",
  end: "",
  author: "",
  editor: false,
  nubia: false,
  current: 1,
  pagesize: 50,
});
export function readArticleQuery(
  view: ArticleView,
  params: URLSearchParams,
): CmsArticleQuery {
  const parsed = cmsArticleQuerySchema.safeParse({
    ...defaultQuery(view),
    id: params.get("id") ? Number(params.get("id")) : null,
    classid: params.get("classid") ? Number(params.get("classid")) : null,
    title: params.get("title") ?? "",
    start: params.get("start") ?? "",
    end: params.get("end") ?? "",
    author: params.get("author") ?? "",
    editor: params.get("editor") === "1",
    nubia: params.get("nubia") === "1",
    current: Number(params.get("current") ?? 1),
    pagesize: Number(params.get("pagesize") ?? 50),
  });
  const query = parsed.success ? parsed.data : defaultQuery(view);
  // 隐藏筛选不从其他级别泄漏，即使用户手动修改 URL 也遵守原站页面范围。
  if (view !== "quality") query.nubia = false;
  if (view === "review-2" || view === "review-3") {
    query.author = "";
    query.editor = false;
  }
  return query;
}
export function articleQueryParams(query: CmsArticleQuery) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (name === "view" || value === null || value === "") continue;
    params.set(
      name,
      typeof value === "boolean" ? (value ? "1" : "0") : String(value),
    );
  }
  return params;
}
export function articleInput(article: CmsArticleDetail): ArticleUpdate {
  return {
    id: article.id,
    title: article.title ?? "",
    classId: article.classId,
    className: article.className ?? "",
    titlePic: article.titlePic ?? "",
    titlePic2: article.titlePic2 ?? "",
    titlePic3: article.titlePic3 ?? "",
    tags: [...article.tags],
    smallText: article.smallText ?? "",
    writer: article.writer ?? "",
    sourceUrl: article.sourceUrl ?? "",
    newsText: article.newsText,
  };
}
export function articleUrl(view: ArticleView, id: number) {
  return `https://mini.jnnc.com/${view === "quality" ? "h" : "preview"}/${id}.html?zn=mr`;
}
// 仅展示时补全协议；请求快照里的原值不改变。
export function articleImageUrl(value: string | null) {
  if (!value) return null;
  const normalized = value.startsWith("//") ? `https:${value}` : value;
  // 列表与可手填字段均是外部输入，无效地址只显示占位，保留提交原值。
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" && !url.username && !url.password
      ? normalized
      : null;
  } catch {
    return null;
  }
}

const fields = [
  ["id", "ID", 100],
  ["className", "分类", 140],
  ["title", "标题", 340],
  ["titlePic", "TitlePic", 160],
  ["titlePic2", "TitlePic2", 160],
  ["titlePic3", "TitlePic3", 160],
  ["writer", "作者", 130],
  ["pages", "分页数", 90],
  ["comment", "Comment", 220],
  ["tags", "Tags", 180],
  ["nTags", "NTags", 180],
  ["newsTime", "新闻时间", 180],
  ["sourceUrl", "来源链接", 240],
  ["actions", "操作", 230],
] as const;
export const articleColumns = fields.map(([id, label, size]) => ({
  id,
  label,
  size,
  minSize: id === "actions" ? 230 : 72,
  maxSize: 800,
  enableHiding: id !== "actions",
}));
