import { useState } from "react";
import { AlertCircle, Unplug, Send } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { ArticleTable } from "@/components/common/ArticleTable";
import { LoadState } from "@/components/common/LoadState";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useArticles } from "@/hooks/use-articles";
import { demoPublishJobs } from "@/features/publishing/model";
import { articleService } from "@/services/cms";

export default function Publish() {
  const { articles, loading, error } = useArticles();
  const [busy, setBusy] = useState(false);
  const pending = articles.filter((a) => a.status === "review");
  async function publish() {
    if (!pending[0]) return;
    setBusy(true);
    try {
      await articleService.publishArticle(pending[0].id);
    } catch (reason: unknown) {
      toast.error(reason instanceof Error ? reason.message : "发布失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader title="发布管理" description="查看待发布稿件与任务状态。" />
      <div className="mb-5 flex items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-4 text-sm">
        <Unplug className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div>
          <p className="font-medium">发布接口尚未接入</p>
          <p className="mt-1 text-xs text-muted-foreground">
            当前列表为演示数据，所有操作均不会向外部 CMS 发布文章。
          </p>
        </div>
      </div>
      <Tabs defaultValue="pending">
        <TabsList className="mb-4">
          <TabsTrigger value="pending">
            待发布稿件 ({pending.length})
          </TabsTrigger>
          <TabsTrigger value="jobs">发布任务</TabsTrigger>
        </TabsList>
        <TabsContent value="pending">
          <Card className="gap-0 overflow-hidden py-0 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between py-4">
              <CardTitle className="text-base">等待发布</CardTitle>
              <Button
                variant="outline"
                size="sm"
                disabled={!pending.length || busy}
                onClick={publish}
              >
                <Send className="size-3.5" />
                检查发布连接
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <LoadState loading={loading} error={error} />
              {!loading && !error && (
                <ArticleTable articles={pending} preferenceKey="publish" />
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="jobs">
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-base">任务记录</CardTitle>
              <CardDescription>以下记录仅用于展示失败状态。</CardDescription>
            </CardHeader>
            <CardContent>
              {demoPublishJobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-start gap-3 rounded-md border p-4"
                >
                  <AlertCircle className="size-4 text-destructive" />
                  <div>
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
                      {articles.find((a) => a.id === job.articleId)?.title ??
                        "演示发布任务"}
                      <Badge variant="outline">演示 · 失败</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{job.error}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
