import { z } from "zod";
import { promoteInputSchema } from "./cms";

export const articleViews = [
  "quality",
  "review-1",
  "review-2",
  "review-3",
] as const;
export const articleViewSchema = z.enum(articleViews);
export type ArticleView = z.infer<typeof articleViewSchema>;
export const articlePageSizes = [10, 20, 30, 50, 100, 200, 500] as const;
const optionalDate = z.union([z.literal(""), z.iso.date()]);
export const cmsArticleQuerySchema = z
  .object({
    view: articleViewSchema,
    id: z.number().int().positive().safe().nullable(),
    classid: z.number().int().positive().safe().nullable(),
    title: z.string(),
    start: optionalDate,
    end: optionalDate,
    author: z.string(),
    editor: z.boolean(),
    nubia: z.boolean(),
    current: z.number().int().positive().max(4_294_967_295),
    pagesize: z.union(articlePageSizes.map((size) => z.literal(size))),
  })
  .refine(
    (q) => !q.start || !q.end || q.start <= q.end,
    "开始日期不能晚于结束日期",
  );
export type CmsArticleQuery = z.infer<typeof cmsArticleQuerySchema>;
const nullableText = z.string().nullable();
export const cmsArticleRowSchema = z.object({
  snapshot: z.record(z.string(), z.unknown()),
  id: z.number().int().positive().safe(),
  classId: z.number().int(),
  className: nullableText,
  title: nullableText,
  titlePic: nullableText,
  titlePic2: nullableText,
  titlePic3: nullableText,
  writer: nullableText,
  smallText: nullableText,
  sourceUrl: nullableText,
  newsTime: nullableText,
  pages: z.number().int().nonnegative().nullable(),
  tags: z.array(z.string()),
  nTags: z.array(z.string()),
  commentRecommand: z.string(),
  commentPromote: z.array(z.string()),
});
export type CmsArticleRow = z.infer<typeof cmsArticleRowSchema>;
export const cmsArticleDetailSchema = cmsArticleRowSchema.extend({
  newsText: z.string(),
  status: z.number().int(),
  updatedAt: nullableText,
});
export type CmsArticleDetail = z.infer<typeof cmsArticleDetailSchema>;
export const cmsArticlePageSchema = z.object({
  data: z.array(cmsArticleRowSchema),
  total: z.number().int().nonnegative(),
  current: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type CmsArticlePage = z.infer<typeof cmsArticlePageSchema>;
export const articleClassesSchema = z.array(
  z.object({ id: z.number().int().positive(), name: z.string() }),
);
export type ArticleClass = z.infer<typeof articleClassesSchema>[number];
export const articleUpdateSchema = z.object({
  id: z.number().int().positive().safe(),
  title: z.string().refine((v) => !!v.trim(), "标题必填"),
  classId: z.number().int().positive(),
  className: z.string(),
  titlePic: z.string().refine((v) => !!v.trim(), "TitlePic 必填"),
  titlePic2: z.string(),
  titlePic3: z.string(),
  tags: z.array(z.string()),
  smallText: z.string(),
  writer: z.string(),
  sourceUrl: z.string(),
  newsText: z.string(),
});
export type ArticleUpdate = z.infer<typeof articleUpdateSchema>;
// 从文章添加必须保留来源行快照；与 Id=0 的普通新增素材分开校验、提交。
export const articlePromoteSchema = z.object({
  article: cmsArticleRowSchema,
  input: promoteInputSchema,
});
export type ArticlePromoteInput = z.infer<typeof articlePromoteSchema>;

export const reviewViewSchema = z.enum(["review-1", "review-2", "review-3"]);
export type ReviewView = z.infer<typeof reviewViewSchema>;
export const reviewDecisionSchema = z.enum(["accept", "reject"]);
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;
const reviewFields = {
  view: reviewViewSchema,
  decision: reviewDecisionSchema,
  comment: z.string(),
};
export const articleReviewSchema = z.object({
  ...reviewFields,
  article: cmsArticleDetailSchema,
});
export const articlesReviewSchema = z
  .object({
    ...reviewFields,
    articles: z.array(cmsArticleRowSchema).min(1).max(500),
  })
  .refine(
    (input) =>
      new Set(input.articles.map((row) => row.id)).size ===
      input.articles.length,
    "文章不能重复",
  );
export type ArticleReviewInput = z.infer<typeof articleReviewSchema>;
export type ArticlesReviewInput = z.infer<typeof articlesReviewSchema>;
export const articleReviewSummarySchema = z.object({
  authExpired: z.boolean(),
  items: z.array(
    z.object({
      id: z.number().int().positive().safe(),
      title: nullableText,
      status: z.enum(["succeeded", "failed", "unconfirmed", "notAttempted"]),
      code: nullableText,
      message: z.string(),
    }),
  ),
});
export type ArticleReviewSummary = z.infer<typeof articleReviewSummarySchema>;
