import { useEffect, useState } from "react";
import { articleService } from "@/services/cms";
import type { Article } from "@/types/article";
import { toast } from "sonner";

export function useArticles() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    articleService
      .getArticles()
      .then((data) => {
        if (active) setArticles(data);
      })
      .catch((reason: unknown) => {
        if (active) {
          const message =
            reason instanceof Error ? reason.message : "读取文章失败";
          setError(message);
          toast.error(message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return { articles, loading, error };
}
