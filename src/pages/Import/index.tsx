import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Download, Link2, ArrowRight, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { importService } from "@/features/import/service";
import { importUrlSchema, type Article } from "@/types/article";

export default function ImportPage() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Article | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = importUrlSchema.safeParse(url.trim());
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await importService.importArticle(parsed.data));
      toast.success("演示素材已创建，未抓取网页内容");
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : "导入失败";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title="素材导入"
        description="把分散的新闻素材，带入有序的编辑流程。"
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 className="size-4" />
              通过链接导入
            </CardTitle>
            <CardDescription>
              当前为流程演示，不会访问或抓取输入的网址。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <label htmlFor="article-url" className="text-sm font-medium">
                文章链接
              </label>
              <Input
                id="article-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/news/article"
                required
                aria-invalid={!!error}
                aria-describedby={error ? "import-error" : undefined}
              />
              <p className="text-xs text-muted-foreground">
                支持 HTTP / HTTPS。真实采集工具将在后续接入。
              </p>
              {error && (
                <p
                  id="import-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {error}
                </p>
              )}
              <Button disabled={busy} type="submit">
                {busy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                {busy ? "正在创建…" : "创建演示素材"}
              </Button>
            </form>
            {result && (
              <div
                className="mt-6 rounded-lg border bg-muted/30 p-4"
                role="status"
              >
                <Badge variant="secondary">演示任务已完成</Badge>
                <h2 className="mt-3 font-medium">{result.title}</h2>
                <p className="mt-2 break-all text-xs text-muted-foreground">
                  {result.source.url}
                </p>
                <p className="mt-3 text-sm text-muted-foreground">
                  {result.content}
                </p>
                <Button variant="outline" asChild className="mt-4">
                  <Link to={`/editor/${result.id}`}>
                    进入编辑
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="h-fit bg-muted/30 shadow-none">
          <CardHeader>
            <CardTitle className="text-sm">从采集到稿件</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {["提交新闻链接", "保留原始素材", "创建独立编辑草稿"].map(
              (label, index) => (
                <div key={label} className="flex items-center gap-3 text-sm">
                  <span className="flex size-7 items-center justify-center rounded-full border bg-background text-xs text-muted-foreground">
                    0{index + 1}
                  </span>
                  {label}
                </div>
              ),
            )}
            <p className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">
              原始素材独立保留。编辑和保存稿件不会覆盖导入原文。
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
