import { useEffect, useId, useMemo, useRef, useState } from "react";
import ReactCrop, { type PercentCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import {
  Check,
  Crop,
  ImageIcon,
  LoaderCircle,
  LockKeyhole,
  Maximize,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { onClientInvalidated } from "@/services/tauri/client";
import { blobFromBase64, imageService } from "./service";
import {
  MAX_IMAGE_SIZE,
  imagePresetSchema,
  imageSizeSchema,
  imageSizeLabel,
  type ImageFormat,
  type ImageInspection,
  type ImageProcessorPreset,
  type ImageProcessorProps,
} from "./model";
import "./image-processor.css";

const formatOptions: { value: ImageFormat; label: string }[] = [
  { value: "jpeg", label: "JPG / JPEG" },
  { value: "png", label: "PNG" },
  { value: "webp", label: "WebP" },
];

function useBlobUrl(blob: Blob | null) {
  const [entry, setEntry] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setEntry({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return entry?.blob === blob ? entry.url : undefined;
}

function initialCrop(
  width: number,
  height: number,
  aspect?: number,
): PercentCrop {
  let w = 100,
    h = 100;
  if (aspect) {
    if (width / height > aspect) w = ((height * aspect) / width) * 100;
    else h = (width / aspect / height) * 100;
  }
  return { unit: "%", x: (100 - w) / 2, y: (100 - h) / 2, width: w, height: h };
}

type Loaded = {
  image: Blob;
  key: string;
  info?: ImageInspection;
  preset?: ImageProcessorPreset;
  error?: string;
};

export function ImageProcessor({
  image,
  preset = {},
  onConfirm,
  onCancel,
}: ImageProcessorProps) {
  const key = JSON.stringify(preset);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const inspection = useRef<AbortController | null>(null);
  function cancel() {
    inspection.current?.abort();
    setLoaded({ image, key, error: "图片处理已取消" });
    onCancel();
  }
  useEffect(() => {
    const controller = new AbortController();
    inspection.current = controller;
    const parsed = imagePresetSchema.safeParse(JSON.parse(key));
    setLoaded({ image, key });
    const unsubscribe = onClientInvalidated(() => {
      controller.abort();
      setLoaded({ image, key, error: "登录状态已变化，请重新选择图片" });
    });
    if (!parsed.success)
      setLoaded({
        image,
        key,
        error: "图片预设无效，请检查格式、体积上限和输出宽高",
      });
    else
      void imageService
        .inspect(image, controller.signal)
        .then((info) => {
          if (!controller.signal.aborted)
            setLoaded({ image, key, info, preset: parsed.data });
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted)
            setLoaded({
              image,
              key,
              error: reason instanceof Error ? reason.message : "图片读取失败",
            });
        });
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [image, key]);
  const current = loaded?.image === image && loaded.key === key ? loaded : null;
  if (!current?.info || !current.preset)
    return (
      <div className="flex min-h-96 flex-col items-center justify-center gap-4 rounded-xl border bg-card p-8">
        {current?.error ? (
          <>
            <ImageIcon className="size-9 text-muted-foreground" />
            <p role="alert">{current.error}</p>
            <Button variant="outline" onClick={cancel}>
              返回选择图片
            </Button>
          </>
        ) : (
          <>
            <LoaderCircle className="size-7 animate-spin" />
            <p role="status">正在检查图片和色彩配置…</p>
            <Button variant="outline" onClick={cancel}>
              取消
            </Button>
          </>
        )}
      </div>
    );
  return (
    <ProcessorEditor
      key={key}
      image={image}
      info={current.info}
      preset={current.preset}
      onConfirm={onConfirm}
      onCancel={cancel}
    />
  );
}

function ProcessorEditor({
  image,
  info,
  preset,
  onConfirm,
  onCancel,
}: ImageProcessorProps & {
  info: ImageInspection;
  preset: ImageProcessorPreset;
}) {
  const instanceId = useId();
  const preview = useMemo(
    () => blobFromBase64(info.previewBase64, "image/png"),
    [info.previewBase64],
  );
  const originalUrl = useBlobUrl(preview);
  const [format, setFormat] = useState<ImageFormat>(
    preset.format ?? info.format,
  );
  const [width, setWidth] = useState(String(preset.size?.width ?? info.width));
  const [height, setHeight] = useState(
    String(preset.size?.height ?? info.height),
  );
  const [resize, setResize] = useState(Boolean(preset.size));
  const [cropping, setCropping] = useState(Boolean(preset.size));
  const [crop, setCrop] = useState<PercentCrop>(() =>
    initialCrop(
      info.width,
      info.height,
      preset.size ? preset.size.width / preset.size.height : undefined,
    ),
  );
  const [maxKiB, setMaxKiB] = useState(
    preset.maxBytes === undefined ? "" : String(preset.maxBytes / 1024),
  );
  const [quality, setQuality] = useState(90);
  const [processed, setProcessed] = useState<Awaited<
    ReturnType<typeof imageService.process>
  > | null>(null);
  const [resultView, setResultView] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const operation = useRef<AbortController | null>(null);
  const version = useRef(0);
  const viewport = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 700, height: 480 });
  const resultUrl = useBlobUrl(processed?.result.file ?? null);
  useEffect(
    () => () => {
      version.current += 1;
      operation.current?.abort();
    },
    [],
  );
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth && node.clientHeight)
        setBounds({ width: node.clientWidth, height: node.clientHeight });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const shown = resultView && processed ? processed.result : info;
  const fit = Math.max(
    0.01,
    Math.min(
      (bounds.width - 48) / shown.width,
      (bounds.height - 48) / shown.height,
      1,
    ),
  );
  const scale = zoom ?? fit;
  const aspect =
    resize && Number(width) > 0 && Number(height) > 0
      ? Number(width) / Number(height)
      : undefined;
  function invalidate() {
    version.current += 1;
    operation.current?.abort();
    operation.current = null;
    setProcessed(null);
    setResultView(false);
    setBusy(false);
    setError(null);
  }
  function reset() {
    invalidate();
    setFormat(preset.format ?? info.format);
    setWidth(String(preset.size?.width ?? info.width));
    setHeight(String(preset.size?.height ?? info.height));
    setResize(Boolean(preset.size));
    setCropping(Boolean(preset.size));
    setCrop(
      initialCrop(
        info.width,
        info.height,
        preset.size ? preset.size.width / preset.size.height : undefined,
      ),
    );
    setMaxKiB(
      preset.maxBytes === undefined ? "" : String(preset.maxBytes / 1024),
    );
    setQuality(90);
    setZoom(null);
  }
  function changeDimension(axis: "width" | "height", value: string) {
    invalidate();
    if (axis === "width") setWidth(value);
    else setHeight(value);
    const w = Number(axis === "width" ? value : width),
      h = Number(axis === "height" ? value : height);
    if (w > 0 && h > 0) setCrop(initialCrop(info.width, info.height, w / h));
  }
  async function process() {
    if (operation.current) return;
    setError(null);
    const size = resize
      ? { width: Number(width), height: Number(height) }
      : undefined;
    if (size && !imageSizeSchema.safeParse(size).success) {
      setError("请输入有效的整数宽高：单边最多 16384 像素，总像素最多 2400 万");
      return;
    }
    const maxBytes =
      preset.maxBytes ??
      (maxKiB.trim() === "" ? undefined : Math.round(Number(maxKiB) * 1024));
    if (
      maxBytes !== undefined &&
      (!Number.isSafeInteger(maxBytes) ||
        maxBytes <= 0 ||
        maxBytes > MAX_IMAGE_SIZE)
    ) {
      setError("体积上限需大于零且不超过 20480 KiB");
      return;
    }
    const selection = cropping ? crop : initialCrop(info.width, info.height);
    const controller = new AbortController();
    const current = ++version.current;
    operation.current = controller;
    setBusy(true);
    setProcessed(null);
    setResultView(false);
    try {
      const result = await imageService.process(
        image,
        {
          crop: {
            x: selection.x / 100,
            y: selection.y / 100,
            width: selection.width / 100,
            height: selection.height / 100,
          },
          size,
          format,
          maxBytes,
          quality,
        },
        preset,
        controller.signal,
      );
      if (version.current === current && !controller.signal.aborted) {
        setProcessed(result);
        setResultView(true);
        setZoom(null);
      }
    } catch (reason) {
      if (version.current === current && !controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : "图片处理失败");
    } finally {
      if (version.current === current) {
        setBusy(false);
        operation.current = null;
      }
    }
  }
  const upscaled =
    resize && Number(width) > info.width * (cropping ? crop.width / 100 : 1);
  const lockedLabel = (
    <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
      <LockKeyhole className="size-3" />
      预设锁定
    </span>
  );
  return (
    <section
      className="image-processor overflow-hidden rounded-xl border bg-card shadow-sm"
      aria-label="图片处理组件"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <ImageIcon className="size-4 shrink-0" />
          <span className="max-w-80 truncate">
            {image instanceof File ? image.name : "图片处理"}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          本地处理 · 原图独立保留
        </span>
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col border-b lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <div className="flex gap-1" aria-label="图片预览模式">
              <Button
                size="sm"
                variant={resultView ? "ghost" : "secondary"}
                onClick={() => {
                  setResultView(false);
                  setZoom(null);
                }}
              >
                原图 / 裁剪
              </Button>
              <Button
                size="sm"
                variant={resultView ? "secondary" : "ghost"}
                disabled={!processed}
                onClick={() => {
                  setResultView(true);
                  setZoom(null);
                }}
              >
                处理结果
              </Button>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {Math.round(scale * 100)}%
            </span>
          </div>
          <div
            ref={viewport}
            className="image-processor-viewport relative h-[min(58vh,620px)] min-h-80 flex-1 overflow-auto bg-neutral-950"
            aria-label="图片裁剪工作区"
          >
            <div className="grid min-h-full min-w-full w-max place-items-center p-6">
              {resultView && resultUrl ? (
                <img
                  src={resultUrl}
                  alt="实际编码后的图片"
                  className="image-transparency block max-w-none"
                  style={{
                    width: shown.width * scale,
                    height: shown.height * scale,
                  }}
                  draggable={false}
                />
              ) : originalUrl ? (
                <ReactCrop
                  crop={cropping ? crop : undefined}
                  aspect={aspect}
                  disabled={busy || !cropping}
                  keepSelection
                  ruleOfThirds
                  onChange={(_, percent) => {
                    invalidate();
                    setCrop(percent);
                  }}
                  ariaLabels={{
                    cropArea: "裁剪选区",
                    nwDragHandle: "左上裁剪手柄",
                    nDragHandle: "上方裁剪手柄",
                    neDragHandle: "右上裁剪手柄",
                    eDragHandle: "右侧裁剪手柄",
                    seDragHandle: "右下裁剪手柄",
                    sDragHandle: "下方裁剪手柄",
                    swDragHandle: "左下裁剪手柄",
                    wDragHandle: "左侧裁剪手柄",
                  }}
                >
                  <img
                    src={originalUrl}
                    alt="待裁剪的原图"
                    className="image-transparency block max-w-none"
                    style={{
                      width: info.width * scale,
                      height: info.height * scale,
                    }}
                    draggable={false}
                  />
                </ReactCrop>
              ) : (
                <LoaderCircle className="size-6 animate-spin text-white" />
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
            <div className="flex gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="缩小查看"
                onClick={() => setZoom(Math.max(0.01, scale / 1.25))}
              >
                <ZoomOut className="size-4" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="放大查看"
                onClick={() => setZoom(Math.min(8, scale * 1.25))}
              >
                <ZoomIn className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setZoom(null)}>
                <Maximize className="size-3.5" />
                适应窗口
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setZoom(1)}>
                100%
              </Button>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {shown.width} × {shown.height} px ·{" "}
              {imageSizeLabel(shown.byteSize)}
            </span>
          </div>
        </div>
        <aside className="flex min-w-0 flex-col" aria-label="图片输出参数">
          <div className="space-y-5 p-4">
            <div>
              <h3 className="text-sm font-semibold">输出设置</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                压缩仅调整编码质量，保留输出尺寸。
              </p>
            </div>
            <div className="space-y-2">
              <label
                htmlFor={`${instanceId}-format`}
                className="flex items-center text-xs font-medium"
              >
                图片格式{preset.format && lockedLabel}
              </label>
              <Select<ImageFormat>
                items={formatOptions}
                value={format}
                disabled={busy || Boolean(preset.format)}
                onValueChange={(value) => {
                  if (value === null) return;
                  invalidate();
                  setFormat(value);
                }}
              >
                <SelectTrigger
                  id={`${instanceId}-format`}
                  className="h-9 w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {formatOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {format === "jpeg" && (
                <p className="text-xs text-muted-foreground">
                  透明区域将合成为白色背景。
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label
                htmlFor={`${instanceId}-limit`}
                className="flex items-center text-xs font-medium"
              >
                文件体积上限{preset.maxBytes !== undefined && lockedLabel}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id={`${instanceId}-limit`}
                  type="number"
                  min="0.001"
                  max="20480"
                  step="any"
                  placeholder="不限，最多 20 MiB"
                  value={maxKiB}
                  disabled={busy || preset.maxBytes !== undefined}
                  onChange={(e) => {
                    invalidate();
                    setMaxKiB(e.target.value);
                  }}
                />
                <span className="text-xs text-muted-foreground">KiB</span>
              </div>
              <p className="text-xs text-muted-foreground">
                无法满足上限时，将阻止确认。
              </p>
            </div>
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center gap-2 text-xs font-medium">
                <Maximize className="size-3.5" />
                输出尺寸{preset.size && lockedLabel}
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={resize}
                  disabled={busy || Boolean(preset.size)}
                  onChange={(e) => {
                    invalidate();
                    setResize(e.target.checked);
                    if (e.target.checked) {
                      setCropping(true);
                      setCrop(
                        initialCrop(
                          info.width,
                          info.height,
                          Number(width) / Number(height),
                        ),
                      );
                    }
                  }}
                />
                指定输出宽高
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor={`${instanceId}-width`}
                    className="mb-1 block text-xs text-muted-foreground"
                  >
                    宽度 / px
                  </label>
                  <Input
                    id={`${instanceId}-width`}
                    type="number"
                    min="1"
                    max="16384"
                    value={width}
                    disabled={busy || !resize || Boolean(preset.size)}
                    onChange={(e) => changeDimension("width", e.target.value)}
                  />
                </div>
                <div>
                  <label
                    htmlFor={`${instanceId}-height`}
                    className="mb-1 block text-xs text-muted-foreground"
                  >
                    高度 / px
                  </label>
                  <Input
                    id={`${instanceId}-height`}
                    type="number"
                    min="1"
                    max="16384"
                    value={height}
                    disabled={busy || !resize || Boolean(preset.size)}
                    onChange={(e) => changeDimension("height", e.target.value)}
                  />
                </div>
              </div>
              {upscaled && (
                <p
                  role="status"
                  className="text-xs text-amber-600 dark:text-amber-400"
                >
                  输出尺寸大于选区，将放大图片，清晰度可能下降。
                </p>
              )}
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={cropping}
                  disabled={busy || resize}
                  onChange={(e) => {
                    invalidate();
                    setCropping(e.target.checked);
                    setCrop(initialCrop(info.width, info.height));
                  }}
                />
                <Crop className="size-3.5" />
                启用裁剪
              </label>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {resize
                  ? "按输出比例移动或缩放裁剪框，确认取景。"
                  : "未指定宽高时，保留原图或选区的像素尺寸。"}
              </p>
            </div>
            {format !== "png" && (
              <div className="space-y-2 border-t pt-4">
                <label
                  htmlFor={`${instanceId}-quality`}
                  className="flex justify-between text-xs font-medium"
                >
                  <span>优先画质</span>
                  <span>{quality}</span>
                </label>
                <input
                  id={`${instanceId}-quality`}
                  aria-label="优先画质"
                  type="range"
                  min="60"
                  max="100"
                  step="1"
                  className="w-full accent-primary"
                  value={quality}
                  disabled={busy}
                  onChange={(e) => {
                    invalidate();
                    setQuality(Number(e.target.value));
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  体积受限时自动降低质量，最低为 60。
                </p>
              </div>
            )}
            {format === "png" && (
              <p className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">
                优先无损优化。必要时尝试有损减色，明显色差的结果会被拒绝。
              </p>
            )}
            <div
              className="rounded-lg border bg-muted/40 p-3 text-xs leading-6"
              aria-live="polite"
            >
              <p className="flex justify-between">
                <span className="text-muted-foreground">原图</span>
                <span>
                  {info.width} × {info.height} · {imageSizeLabel(info.byteSize)}
                </span>
              </p>
              {processed ? (
                <>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">结果</span>
                    <span>
                      {processed.result.width} × {processed.result.height} ·{" "}
                      {imageSizeLabel(processed.result.byteSize)}
                    </span>
                  </p>
                  <p className="text-muted-foreground">
                    {processed.result.format.toUpperCase()} ·{" "}
                    {processed.lossy
                      ? `有损编码${processed.quality ? ` / 质量 ${processed.quality}` : ""}`
                      : "无损编码"}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">
                  {busy ? "正在编码并验证结果…" : "处理预览后显示实际结果。"}
                </p>
              )}
            </div>
            {error && (
              <p
                role="alert"
                className="break-words text-xs leading-relaxed text-destructive"
              >
                {error}
              </p>
            )}
            {busy && (
              <p role="status" className="flex items-center gap-2 text-xs">
                <LoaderCircle className="size-4 animate-spin" />
                正在处理，请稍候…
              </p>
            )}
            <Button
              className="w-full"
              variant="secondary"
              disabled={busy}
              onClick={() => void process()}
            >
              {busy ? "正在处理…" : "处理预览"}
            </Button>
          </div>
        </aside>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-4 py-3">
        <Button variant="ghost" onClick={reset}>
          <RotateCcw className="size-4" />
          重置
        </Button>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              invalidate();
              onCancel();
            }}
          >
            取消
          </Button>
          <Button
            disabled={busy || !processed}
            onClick={() => {
              if (processed && !busy) onConfirm(processed.result);
            }}
          >
            <Check className="size-4" />
            确认结果
          </Button>
        </div>
      </div>
    </section>
  );
}
