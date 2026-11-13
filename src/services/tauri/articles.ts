import { z } from "zod";
import {
  cmsArticleQuerySchema,
  cmsArticlePageSchema,
  cmsArticleDetailSchema,
  articleClassesSchema,
  articleUpdateSchema,
  articlePromoteSchema,
  articleReviewSchema,
  articlesReviewSchema,
  articleReviewSummarySchema,
  type ArticleReviewInput,
  type ArticlesReviewInput,
  type CmsArticleQuery,
  type ArticleUpdate,
  type ArticlePromoteInput,
} from "@/types/cms-article";
import { mutationResultSchema } from "@/types/cms";
import { invokeCommand } from "./client";

// 后台 DTO 在 IPC 边界校验，业务组件不直接 invoke 或携带认证信息。
export const articleIpc = {
  review: (request: ArticleReviewInput) =>
    invokeCommand("cms_review_article", articleReviewSummarySchema, {
      request: articleReviewSchema.parse(request),
    }),
  reviewBatch: (request: ArticlesReviewInput) =>
    invokeCommand("cms_review_articles", articleReviewSummarySchema, {
      request: articlesReviewSchema.parse(request),
    }),
  list: (query: CmsArticleQuery) =>
    invokeCommand("cms_list_articles", cmsArticlePageSchema, {
      query: cmsArticleQuerySchema.parse(query),
    }),
  classes: () =>
    invokeCommand("cms_list_article_classes", articleClassesSchema),
  get: (id: number) =>
    invokeCommand("cms_get_article", cmsArticleDetailSchema, {
      id: z.number().int().positive().safe().parse(id),
    }),
  update: (request: ArticleUpdate) =>
    invokeCommand("cms_update_article", mutationResultSchema, {
      request: articleUpdateSchema.parse(request),
    }),
  promote: (request: ArticlePromoteInput) =>
    invokeCommand("cms_add_article_to_promote", mutationResultSchema, {
      request: articlePromoteSchema.parse(request),
    }),
};
