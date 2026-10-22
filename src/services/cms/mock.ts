import { z } from "zod";
import demoData from "@/features/articles/demo-articles.json";
import {
  articleSchema,
  draftInputSchema,
  importUrlSchema,
  type Article,
  type SaveDraftRequest,
} from "@/types/article";
import { ServiceError } from "@/services/tauri/client";
import type { CmsAdapter } from "./adapter";

export class MockCmsAdapter implements CmsAdapter {
  private articles = z.array(articleSchema).parse(structuredClone(demoData));
  async getArticles() {
    return structuredClone(this.articles);
  }
  async getArticle(id: string) {
    const article = this.articles.find((a) => a.id === id);
    if (!article) throw new ServiceError("NOT_FOUND", "文章不存在");
    return structuredClone(article);
  }
  async saveDraft(input: SaveDraftRequest) {
    const request = draftInputSchema.parse(input);
    const article = await this.getArticle(request.id);
    const updated: Article = {
      ...article,
      title: request.title,
      content: request.content,
      status: "draft",
      updatedAt: new Date().toISOString(),
    };
    this.articles = this.articles.map((a) =>
      a.id === request.id ? updated : a,
    );
    return structuredClone(updated);
  }
  async importArticle(input: string) {
    const url = importUrlSchema.parse(input);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const title = "待编辑的演示素材";
    const content =
      "这是导入流程的演示素材，未抓取目标网页。真实采集服务尚未连接。";
    const article: Article = {
      id,
      source: { id: `source-${id}`, title, url, content, importedAt: now },
      title,
      content,
      status: "imported",
      createdAt: now,
      updatedAt: now,
      isDemo: true,
    };
    this.articles.unshift(article);
    return structuredClone(article);
  }
  async publishArticle(_id: string): Promise<void> {
    throw new ServiceError("NOT_CONFIGURED", "CMS 尚未连接，未执行发布");
  }
}
