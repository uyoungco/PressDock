import type { Article } from "@/types/article";

export interface CmsAdapter {
  importArticle(url: string): Promise<Article>;
  getArticles(): Promise<Article[]>;
  publishArticle(id: string): Promise<void>;
}
