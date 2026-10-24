import { useEffect, useRef, useState } from "react";
import { ImagePlus, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImageProcessor, type ImageProcessorResult } from "@/features/images";
import { MAX_IMAGE_SIZE } from "@/features/images/model";
import { imageService } from "@/features/images/service";

export default function Images() {
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const save = useRef<AbortController | null>(null);
  useEffect(() => () => save.current?.abort(), []);
  async function exportImage(result: ImageProcessorResult) {
    if (save.current) return;
    const controller = new AbortController();
    save.current = controller;
    setSaving(true);
    try {
      const exported = await imageService.export(result, controller.signal);
      if (exported.saved && !controller.signal.aborted)
        toast.success(`图片已保存：${exported.fileName}`);
    } catch (reason) {
      if (!controller.signal.aborted)
        toast.error(reason instanceof Error ? reason.message : "图片保存失败");
    } finally {
      if (!controller.signal.aborted) setSaving(false);
      save.current = null;
    }
  }
  return (
    <>
      <PageHeader
        demo={false}
        title="图片处理"
        description="裁剪取景、控制文件体积，转换为 JPG、PNG 或 WebP。"
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-3">
          <ImagePlus className="size-5 text-muted-foreground" />
          <div>
            <label htmlFor="image-file" className="block text-sm font-medium">
              {file ? "更换图片" : "选择本地图片"}
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              静态 JPG / PNG / WebP · 最大 20 MiB · 处理结果另存为
            </p>
          </div>
        </div>
        <Input
          id="image-file"
          aria-label="选择本地图片"
          className="max-w-xs"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={saving}
          onChange={(e) => {
            const next = e.target.files?.[0];
            e.target.value = "";
            if (!next) return;
            if (!next.size || next.size > MAX_IMAGE_SIZE) {
              toast.error("请选择不超过 20 MiB 的静态 JPG、PNG 或 WebP 图片");
              return;
            }
            setFile(next);
          }}
        />
      </div>
      {file ? (
        <div className="relative">
          <div inert={saving}>
            <ImageProcessor
              image={file}
              onConfirm={(result) => void exportImage(result)}
              onCancel={() => setFile(null)}
            />
          </div>
          {saving && (
            <div
              role="status"
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl bg-background/85 backdrop-blur-sm"
            >
              <LoaderCircle className="size-6 animate-spin" />
              <p className="text-sm">请选择保存位置，完成图片另存为…</p>
              <Button
                variant="outline"
                onClick={() => {
                  save.current?.abort();
                  setSaving(false);
                }}
              >
                取消导出
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-h-96 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 p-8 text-center">
          <ImagePlus className="mb-4 size-12 stroke-1 text-muted-foreground" />
          <h2 className="text-base font-medium">选择一张图片开始处理</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            在左侧拖动裁剪框，在右侧设置输出尺寸、文件体积和格式。确认结果后选择本地保存位置。
          </p>
        </div>
      )}
    </>
  );
}
