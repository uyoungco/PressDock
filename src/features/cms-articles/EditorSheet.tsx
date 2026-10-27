import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/common/SearchableSelect";
import { MaterialImage } from "@/features/channels/MaterialImage";
import { articleService, articleImageUrl } from "./service";
import type { ArticleClass, ArticleUpdate } from "@/types/cms-article";
const RichTextEditor = lazy(() => import("./RichTextEditor"));

export function EditorSheet({
  input,
  classes,
  classesError,
  retryClasses,
  onChange,
  onClose,
  onSave,
  busy,
  uploading,
  onUploading,
  error,
  onError,
}: {
  input: ArticleUpdate;
  classes: ArticleClass[];
  classesError: string | null;
  retryClasses: () => void;
  onChange: (value: ArticleUpdate) => void;
  onClose: () => void;
  onSave: () => void;
  busy: boolean;
  uploading: boolean;
  onUploading: (value: boolean) => void;
  error: string | null;
  onError: (message: string) => void;
}) {
  const [tag, setTag] = useState("");
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const gate = useRef(false);
  const latest = useRef({ input, onChange });
  latest.current = { input, onChange };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // 文件上传结果只回填当前文章；旧会话的 IPC 结果由公共客户端丢弃。
  async function upload(
    file: File,
    field: "titlePic" | "titlePic2" | "titlePic3",
  ) {
    if (busy || uploading || gate.current) return;
    gate.current = true;
    onUploading(true);
    try {
      const image = await articleService.upload(file);
      if (mounted.current)
        latest.current.onChange({
          ...latest.current.input,
          [field]: image.url,
        });
    } catch (error) {
      if (mounted.current)
        onError(error instanceof Error ? error.message : "上传失败");
    } finally {
      gate.current = false;
      if (mounted.current) onUploading(false);
    }
  }
  const locked = busy || uploading;
  function addTag() {
    const value = tag.trim();
    if (value && !input.tags.includes(value))
      onChange({ ...input, tags: [...input.tags, value] });
    setTag("");
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !locked) onClose();
      }}
    >
      <SheetContent
        ref={setPortalContainer}
        side="right"
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-5xl"
        showCloseButton={!locked}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <SheetHeader className="shrink-0 border-b pr-12">
          <SheetTitle>编辑文章 · {input.id}</SheetTitle>
          <SheetDescription>
            保存修改到 CMS。正文保留原有图片和分页标记。
          </SheetDescription>
        </SheetHeader>
        <form
          id="cms-article-edit"
          className="min-h-0 flex-1 overflow-y-auto p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!locked) onSave();
          }}
        >
          <fieldset disabled={locked}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="cms-title">标题 *</FieldLabel>
                <Input
                  id="cms-title"
                  value={input.title}
                  onChange={(event) =>
                    onChange({ ...input, title: event.target.value })
                  }
                />
              </Field>
              <FieldGroup className="grid gap-4 sm:grid-cols-3">
                {(["titlePic", "titlePic2", "titlePic3"] as const).map(
                  (field, index) => (
                    <Field key={field}>
                      <FieldLabel htmlFor={`cms-${field}`}>
                        {index ? `TitlePic${index + 1}` : "TitlePic *"}
                      </FieldLabel>
                      <MaterialImage
                        compact
                        url={articleImageUrl(input[field])}
                        label={`文章图片 ${index + 1}`}
                      />
                      <Input
                        id={`cms-${field}`}
                        value={input[field]}
                        onChange={(event) =>
                          onChange({ ...input, [field]: event.target.value })
                        }
                        onPaste={(event) => {
                          const file = [...event.clipboardData.items]
                            .find(
                              (item) =>
                                item.kind === "file" &&
                                item.type.startsWith("image/"),
                            )
                            ?.getAsFile();
                          if (file) {
                            event.preventDefault();
                            void upload(file, field);
                          }
                        }}
                      />
                      <Input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        aria-label={`上传文章图片 ${index + 1}`}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (file) void upload(file, field);
                        }}
                      />
                    </Field>
                  ),
                )}
              </FieldGroup>
              <Field>
                <FieldLabel htmlFor="cms-class">分类 *</FieldLabel>
                <SearchableSelect
                  portalContainer={portalContainer}
                  id="cms-class"
                  value={String(input.classId)}
                  options={classes.map((item) => ({
                    value: String(item.id),
                    label: item.name,
                  }))}
                  disabled={locked || !classes.length || !!classesError}
                  onValueChange={(value) =>
                    onChange({
                      ...input,
                      classId: Number(value),
                      className: classes.find(
                        (item) => item.id === Number(value),
                      )!.name,
                    })
                  }
                />
                {classesError && (
                  <p role="alert">
                    {classesError}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={retryClasses}
                    >
                      重试分类
                    </Button>
                  </p>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor="cms-tag">标签</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {input.tags.map((value, index) => (
                    <Badge key={`${value}-${index}`} variant="secondary">
                      {value}
                      <button
                        type="button"
                        aria-label={`移除标签 ${value}`}
                        disabled={locked}
                        onClick={() =>
                          onChange({
                            ...input,
                            tags: input.tags.filter((_, i) => i !== index),
                          })
                        }
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    id="cms-tag"
                    value={tag}
                    placeholder="输入标签后按回车"
                    onChange={(event) => setTag(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        addTag();
                      }
                    }}
                  />
                  <Button type="button" variant="outline" onClick={addTag}>
                    添加标签
                  </Button>
                </div>
              </Field>
              <Field>
                <FieldLabel htmlFor="cms-summary">摘要</FieldLabel>
                <Textarea
                  id="cms-summary"
                  value={input.smallText}
                  onChange={(event) =>
                    onChange({ ...input, smallText: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="cms-writer">作者</FieldLabel>
                <Input
                  id="cms-writer"
                  value={input.writer}
                  onChange={(event) =>
                    onChange({ ...input, writer: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="cms-source">来源 URL</FieldLabel>
                <Input
                  id="cms-source"
                  value={input.sourceUrl}
                  onChange={(event) =>
                    onChange({ ...input, sourceUrl: event.target.value })
                  }
                />
              </Field>
            </FieldGroup>
          </fieldset>
          <div className="mt-6 flex flex-col gap-2">
            <p className="text-sm font-medium">正文</p>
            <Suspense fallback={<Skeleton className="h-80" />}>
              <RichTextEditor
                initialHtml={input.newsText}
                disabled={locked}
                onUploading={onUploading}
                onError={onError}
                onChange={(newsText) =>
                  latest.current.onChange({ ...latest.current.input, newsText })
                }
              />
            </Suspense>
          </div>
          {error && (
            <p role="alert" className="mt-4 text-destructive">
              {error}
            </p>
          )}
        </form>
        <SheetFooter className="shrink-0 flex-row justify-end border-t">
          <Button variant="outline" disabled={locked} onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form="cms-article-edit" disabled={locked}>
            {uploading ? "正在上传图片…" : busy ? "正在保存…" : "保存修改"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
