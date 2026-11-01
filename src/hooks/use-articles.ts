import { articleService } from "@/services/cms";
import { businessKeys } from "@/lib/query-runtime";
import { useBusinessQuery, useQueryUser } from "./use-business-query";

export function useArticles() {
  const user = useQueryUser();
  const query = useBusinessQuery(businessKeys.localArticles(user), () =>
    articleService.getArticles(),
  );
  return {
    articles: query.data ?? [],
    loading: query.isPending,
    error: query.error?.message ?? null,
    refreshing: query.isFetching,
    refresh: () => {
      void query.refetch();
    },
  };
}
