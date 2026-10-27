import { describe, it, expect } from "vitest";
import { MockCmsAdapter } from "@/services/cms/mock";
import { importUrlSchema } from "@/types/article";
import { summarizeArticles } from "@/features/articles/model";

describe("文章模型与业务边界", () => {
  it("拒绝非 HTTP 来源", () => {
    expect(importUrlSchema.safeParse("javascript:alert(1)").success).toBe(
      false,
    );
    expect(importUrlSchema.safeParse("file:///etc/passwd").success).toBe(false);
  });
  it("发布未配置时明确失败，演示导入不冒充网页采集", async () => {
    const adapter = new MockCmsAdapter();
    await expect(adapter.publishArticle("demo-1")).rejects.toThrow(
      "未执行发布",
    );
    const article = await adapter.importArticle("https://example.com/new");
    expect(article.isDemo).toBe(true);
    expect(article.content).toContain("未抓取目标网页");
  });
  it("统计只计算符合状态和日期的稿件", async () => {
    const articles = await new MockCmsAdapter().getArticles();
    expect(
      summarizeArticles(articles, new Date("2026-10-22T12:00:00+08:00")),
    ).toEqual({ today: 2, editing: 2, review: 1, published: 1 });
  });
});
