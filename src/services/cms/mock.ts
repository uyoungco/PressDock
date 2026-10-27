import { z } from "zod";
import demoData from "@/features/articles/demo-articles.json";
import { articleSchema, importUrlSchema, type Article } from "@/types/article";
import { ServiceError } from "@/services/tauri/client";
import type { CmsAdapter } from "./adapter";

export class MockCmsAdapter implements CmsAdapter {
  private articles = z.array(articleSchema).parse(structuredClone(demoData));
  async getArticles() {
    return structuredClone(this.articles);
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
    throw new ServiceError(
      "NOT_CONFIGURED",
      "CMS 发布接口尚未接入，未执行发布",
    );
  }
}
