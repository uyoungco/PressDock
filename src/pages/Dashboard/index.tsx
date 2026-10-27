import { Link } from "react-router-dom";
import {
  ArrowRight,
  Download,
  FilePenLine,
  Clock3,
  CheckCheck,
  Files,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { PageHeader } from "@/components/common/PageHeader";
import { ArticleTable } from "@/components/common/ArticleTable";
import { LoadState } from "@/components/common/LoadState";
import { useArticles } from "@/hooks/use-articles";
import { summarizeArticles } from "@/features/articles/model";

export default function Dashboard() {
  const { articles, loading, error } = useArticles();
  const stats = summarizeArticles(articles);
  const cards = [
    {
      label: "今日处理",
      value: stats.today,
      icon: Files,
      detail: "今日更新的稿件",
    },
    {
      label: "待编辑",
      value: stats.editing,
      icon: FilePenLine,
      detail: "导入素材与草稿",
    },
    {
      label: "待发布",
      value: stats.review,
      icon: Clock3,
      detail: "等待发布的稿件",
    },
    {
      label: "已发布",
      value: stats.published,
      icon: CheckCheck,
      detail: "仅演示状态，未实际发布",
    },
  ];
  return (
    <>
      <PageHeader
        title="工作台"
        description="从一条素材开始，让新闻编辑更有条理。"
        action={
          <Button asChild>
            <Link to="/import">
              <Download className="size-4" />
              导入素材
            </Link>
          </Button>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, detail }) => (
          <Card key={label} className="gap-3 py-5 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between px-5">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {label}
              </CardTitle>
              <Icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="px-5">
              <p className="mb-1 text-3xl font-semibold tabular-nums">
                {loading ? "—" : value.toString().padStart(2, "0")}
              </p>
              <p className="text-xs text-muted-foreground">{detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="mb-6 gap-0 overflow-hidden py-0 shadow-none">
        <CardHeader className="flex flex-row items-center justify-between px-5 py-4">
          <div>
            <CardTitle className="text-base">最近处理文章</CardTitle>
            <CardDescription className="mt-1 text-xs">
              演示素材 · 按最近更新时间排序
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/articles">
              全部文章
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <LoadState loading={loading} error={error} />
          {!loading && !error && (
            <ArticleTable
              preferenceKey="dashboard"
              articles={[...articles]
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                .slice(0, 5)}
            />
          )}
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="shadow-none lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">继续你的编辑流程</CardTitle>
            <CardDescription>
              采集、整理、审核，在一个工作空间完成。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button variant="outline" asChild>
              <Link to="/import">
                <Download className="size-4" />
                导入新素材
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/articles">
                <FilePenLine className="size-4" />
                查看文章
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/publish">
                <Clock3 className="size-4" />
                查看发布任务
              </Link>
            </Button>
          </CardContent>
        </Card>
        <Card className="border-dashed bg-muted/20 shadow-none">
          <CardHeader>
            <CardTitle className="text-sm">你的新闻编辑工作空间</CardTitle>
            <CardDescription className="leading-relaxed">
              当前本地稿件为演示素材。渠道素材已可查询，真实采集与发布尚未接入。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              to="/settings"
              className="flex items-center gap-1 text-xs font-medium"
            >
              查看连接设置
              <ArrowRight className="size-3" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
