import { useEffect, useState } from "react";
import { ImagePlus, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IMAGE_RATIOS,
  MAX_IMAGE_SIZE,
  type ImageRatio,
} from "@/features/images/model";

export default function Images() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [ratio, setRatio] = useState<ImageRatio>("original");
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <>
      <PageHeader
        title="图片处理"
        description="预览新闻配图，规划适合栏目的图片比例。"
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">图片工作区</CardTitle>
            <CardDescription>
              仅本地预览，当前不会上传、裁剪或生成处理结果。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <label
              htmlFor="image-file"
              className="mb-3 flex items-center gap-2 text-sm font-medium"
            >
              <ImagePlus className="size-4" />
              选择本地图片
            </label>
            <Input
              id="image-file"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => {
                const next = e.target.files?.[0];
                if (!next) return;
                if (
                  ![
                    "image/png",
                    "image/jpeg",
                    "image/webp",
                    "image/gif",
                  ].includes(next.type) ||
                  next.size > MAX_IMAGE_SIZE
                ) {
                  toast.error(
                    "请选择 20 MB 以内的 PNG、JPEG、WebP 或 GIF 图片",
                  );
                  e.target.value = "";
                  return;
                }
                setFile(next);
              }}
            />
            <div className="mt-5 flex min-h-80 items-center justify-center overflow-hidden rounded-lg border border-dashed bg-muted/30">
              {preview ? (
                <div
                  className="w-full overflow-hidden"
                  style={{ aspectRatio: ratio === "original" ? "auto" : ratio }}
                >
                  <img
                    src={preview}
                    alt={file?.name ?? "本地图片预览"}
                    className="max-h-[60vh] w-full object-contain"
                    onError={() => {
                      setPreview(null);
                      setFile(null);
                      toast.error("图片无法解码，请选择有效的图片文件");
                    }}
                  />
                </div>
              ) : (
                <div className="text-center text-muted-foreground">
                  <ImageIcon className="mx-auto mb-3 size-9 stroke-1" />
                  <p className="text-sm">选择图片开始预览</p>
                  <p className="mt-1 text-xs">
                    PNG / JPEG / WebP / GIF · 最大 20 MB
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="h-fit shadow-none">
          <CardHeader>
            <CardTitle className="text-sm">输出规划</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                目标比例
              </label>
              <Select
                value={ratio}
                onValueChange={(value) => setRatio(value as ImageRatio)}
              >
                <SelectTrigger aria-label="目标图片比例" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMAGE_RATIOS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {file && (
              <div className="break-all text-xs leading-relaxed text-muted-foreground">
                {file.name}
                <br />
                {(file.size / 1024).toFixed(1)} KB
              </div>
            )}
            <p className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">
              比例选择用于预览画布。裁剪坐标、尺寸调整和结果导出将在后续接入。
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
