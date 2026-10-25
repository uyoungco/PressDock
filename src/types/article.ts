import { z } from "zod";

export const articleStatusSchema = z.enum([
  "imported",
  "draft",
  "review",
  "published",
  "failed",
]);
export type ArticleStatus = z.infer<typeof articleStatusSchema>;
export const sourceArticleSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.url({ protocol: /^https?$/ }),
  content: z.string(),
  importedAt: z.iso.datetime(),
});
export const articleSchema = z.object({
  id: z.string().min(1),
  source: sourceArticleSchema,
  title: z
    .string()
    .trim()
    .min(1, "请输入文章标题")
    .refine((value) => [...value].length <= 200, "标题最多 200 字"),
  content: z.string().max(1_000_000, "正文过长"),
  status: articleStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  isDemo: z.boolean(),
});
export type Article = z.infer<typeof articleSchema>;
export type SourceArticle = z.infer<typeof sourceArticleSchema>;
export const draftInputSchema = articleSchema.pick({
  id: true,
  title: true,
  content: true,
});
export type SaveDraftRequest = z.infer<typeof draftInputSchema>;
export const importUrlSchema = z.url({
  protocol: /^https?$/,
  error: "请输入有效的 HTTP 或 HTTPS 链接",
});
