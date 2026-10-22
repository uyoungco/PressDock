import type { Article } from "@/types/article";

export function summarizeArticles(articles: Article[], now = new Date()) {
  return {
    today: articles.filter(
      (a) => new Date(a.updatedAt).toDateString() === now.toDateString(),
    ).length,
    editing: articles.filter((a) => ["imported", "draft"].includes(a.status))
      .length,
    review: articles.filter((a) => a.status === "review").length,
    published: articles.filter((a) => a.status === "published").length,
  };
}
