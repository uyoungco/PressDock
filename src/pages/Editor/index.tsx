import { useEffect, useState } from "react";
import { useParams, useBlocker, useBeforeUnload } from "react-router-dom";
import { useAtom, useSetAtom } from "jotai";
import { Save, FileText, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { LoadState } from "@/components/common/LoadState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { currentArticleIdAtom, editorDirtyAtom } from "@/atoms/editor";
import { editorService } from "@/features/editor/service";
import { isDesktop } from "@/services/tauri/client";
import type { Article } from "@/types/article";
import { useAuth } from "@/hooks/use-auth";
import { authService } from "@/features/auth/service";
import { editorBuffers } from "@/features/editor/buffer";
import { TitleOptimizer } from "@/features/ai/TitleOptimizer";

export default function Editor() {
  const { id = "" } = useParams();
  const userId = useAuth().session?.user.userId ?? 0;
  const [article, setArticle] = useState<Article | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useAtom(editorDirtyAtom);
  const setCurrent = useSetAtom(currentArticleIdAtom);
  const blocker = useBlocker(
    () => dirty && authService.getSnapshot().status === "authenticated",
  );
  useBeforeUnload((event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setCurrent(id);
    editorService
      .load(id)
      .then((data) => {
        if (active) {
          setArticle(data);
          const buffer = editorBuffers.get(userId, id);
          setTitle(buffer?.title ?? data.title);
          setContent(buffer?.content ?? data.content);
          setDirty(
            !!buffer &&
              (buffer.title !== data.title || buffer.content !== data.content),
          );
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          const message =
            reason instanceof Error ? reason.message : "读取草稿失败";
          setError(message);
          toast.error(message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      setDirty(false);
      setCurrent(null);
    };
  }, [id, userId, setCurrent, setDirty]);
  const change = (nextTitle: string, nextContent: string) => {
    setTitle(nextTitle);
    setContent(nextContent);
    editorBuffers.set(userId, id, { title: nextTitle, content: nextContent });
    setDirty(nextTitle !== article?.title || nextContent !== article.content);
  };
  async function save() {
    setSaving(true);
    try {
      const saved = await editorService.save({ id, title, content });
      setArticle(saved);
      setTitle(saved.title);
      setDirty(false);
      editorBuffers.remove(userId, id);
      toast.success(
        isDesktop()
          ? "草稿已保存到本地 SQLite"
          : "草稿已暂存于内存，刷新后重置",
      );
    } catch (reason: unknown) {
      toast.error(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <PageHeader
        title="内容编辑"
        description={
          isDesktop()
            ? "独立编辑稿件，保存至本地工作区。"
            : "浏览器演示：草稿仅暂存内存，桌面端支持 SQLite 持久化。"
        }
        action={
          <Button
            onClick={save}
            disabled={loading || saving || !article || !!error}
          >
            {saving ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            保存草稿
          </Button>
        }
      />
      <LoadState loading={loading} error={error} />
      {!loading && !error && article && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
          <Card className="gap-4 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">编辑稿件</CardTitle>
              <Badge variant={dirty ? "outline" : "secondary"}>
                {dirty ? "有未保存修改" : "已保存"}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <label
                  htmlFor="draft-title"
                  className="text-xs font-medium text-muted-foreground"
                >
                  文章标题
                </label>
                <div className="flex items-start gap-2">
                  <Input
                    id="draft-title"
                    value={title}
                    onChange={(e) => change(e.target.value, content)}
                    disabled={saving}
                  />
                  <TitleOptimizer
                    title={title}
                    content={content}
                    disabled={saving}
                    titleInputId="draft-title"
                    onAdopt={(next) => change(next, content)}
                  />
                </div>
              </div>
              <Tabs defaultValue="edit">
                <TabsList>
                  <TabsTrigger value="edit">正文编辑</TabsTrigger>
                  <TabsTrigger value="source">查看原始素材</TabsTrigger>
                </TabsList>
                <TabsContent value="edit" className="mt-4">
                  <label htmlFor="draft-content" className="sr-only">
                    文章正文
                  </label>
                  <Textarea
                    id="draft-content"
                    value={content}
                    onChange={(e) => change(title, e.target.value)}
                    className="min-h-84 resize-y text-sm leading-8"
                    disabled={saving}
                  />
                  <p className="mt-2 text-right text-xs text-muted-foreground">
                    {content.length} 字符 · 纯文本编辑
                  </p>
                </TabsContent>
                <TabsContent value="source" className="mt-4">
                  <h2 className="mb-3 font-medium">{article.source.title}</h2>
                  <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-4 text-sm leading-8">
                    {article.source.content}
                  </p>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
          <div className="space-y-4">
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FileText className="size-4" />
                  稿件信息
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">文章来源</p>
                  <p className="break-all text-xs leading-relaxed">
                    {article.source.url}
                  </p>
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">素材类型</p>
                  <p>演示素材</p>
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">保存方式</p>
                  <p>{isDesktop() ? "本地 SQLite" : "本次浏览器会话"}</p>
                </div>
              </CardContent>
            </Card>
            <p className="px-1 text-xs leading-relaxed text-muted-foreground">
              原始素材独立保留。当前编辑器不会自动改写原文或调整事实内容。
            </p>
          </div>
        </div>
      )}
      <Dialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.state === "blocked") blocker.reset();
        }}
      >
        <DialogContent>
          <DialogTitle>离开编辑页面？</DialogTitle>
          <DialogDescription>
            当前有尚未保存的修改。离开后这些修改将丢失。
          </DialogDescription>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (blocker.state === "blocked") blocker.reset();
              }}
            >
              继续编辑
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDirty(false);
                editorBuffers.remove(userId, id);
                if (blocker.state === "blocked") blocker.proceed();
              }}
            >
              放弃修改并离开
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
