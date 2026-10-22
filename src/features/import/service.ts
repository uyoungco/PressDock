import { articleService } from "@/services/cms";
import { importUrlSchema } from "@/types/article";
export const importService = {
  importArticle: (url: string) =>
    articleService.importArticle(importUrlSchema.parse(url)),
};
