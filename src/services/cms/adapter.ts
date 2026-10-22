import type { Article, SaveDraftRequest } from "@/types/article";

export interface CmsAdapter {
  importArticle(url: string): Promise<Article>;
  getArticles(): Promise<Article[]>;
  getArticle(id: string): Promise<Article>;
  saveDraft(request: SaveDraftRequest): Promise<Article>;
  publishArticle(id: string): Promise<void>;
}
