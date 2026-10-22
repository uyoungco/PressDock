import { Link } from "react-router-dom";
import { ArrowUpRight, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STATUS_LABELS } from "@/constants/app";
import type { Article } from "@/types/article";

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ArticleTable({ articles }: { articles: Article[] }) {
  if (!articles.length)
    return (
      <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
        <FileText className="size-7" />
        <p className="text-sm">暂无符合条件的文章</p>
      </div>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
          <tr>
            {["文章标题", "来源", "创建时间", "更新时间", "状态", "操作"].map(
              (label) => (
                <th
                  key={label}
                  className="whitespace-nowrap px-4 py-3 font-medium"
                >
                  {label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {articles.map((article) => (
            <tr
              key={article.id}
              className="border-b last:border-0 hover:bg-muted/30"
            >
              <td className="min-w-56 px-4 py-4">
                <Link
                  to={`/editor/${article.id}`}
                  className="font-medium hover:underline"
                >
                  {article.title}
                </Link>
                {article.isDemo && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    演示
                  </span>
                )}
              </td>
              <td className="px-4 text-muted-foreground">
                {new URL(article.source.url).hostname}
              </td>
              <td className="whitespace-nowrap px-4 text-xs text-muted-foreground">
                {formatDate(article.createdAt)}
              </td>
              <td className="whitespace-nowrap px-4 text-xs text-muted-foreground">
                {formatDate(article.updatedAt)}
              </td>
              <td className="whitespace-nowrap px-4">
                <Badge
                  variant={
                    article.status === "failed" ? "destructive" : "secondary"
                  }
                >
                  {STATUS_LABELS[article.status]}
                </Badge>
              </td>
              <td className="px-4">
                <Button variant="ghost" size="sm" asChild>
                  <Link
                    to={`/editor/${article.id}`}
                    aria-label={`编辑：${article.title}`}
                  >
                    编辑
                    <ArrowUpRight className="size-3.5" />
                  </Link>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
