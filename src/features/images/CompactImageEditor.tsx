import { useId, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ImageIcon,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  imageSizeLabel,
  type ImageFormat,
  type ImageInspection,
  type ImageProcessorPreset,
  type ImageProcessorResult,
} from "./model";

export type EditableImageSettings = {
  format: ImageFormat;
  width: string;
  height: string;
  resize: boolean;
  cropping: boolean;
  maxKiB: string;
  quality: number;
};
type Processed = {
  result: ImageProcessorResult;
  quality: number | null;
  lossy: boolean;
};
const formats: { value: ImageFormat; label: string }[] = [
  { value: "jpeg", label: "JPG / JPEG" },
  { value: "png", label: "PNG" },
  { value: "webp", label: "WebP" },
];

export function CompactImageEditor({
  image,
  info,
  preset,
  settings,
  processed,
  busy,
  error,
  upscaled,
  preview,
  confirmationHint,
  onChange,
  onProcess,
  onConfirm,
  onCancel,
  onReset,
}: {
  image: Blob;
  info: ImageInspection;
  preset: ImageProcessorPreset;
  settings: EditableImageSettings;
  processed: Processed | null;
  busy: boolean;
  error: string | null;
  upscaled: boolean;
  preview: ReactNode;
  confirmationHint?: string;
  onChange: (change: Partial<EditableImageSettings>) => void;
  onProcess: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onReset: () => void;
}) {
  const id = useId();
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );
  const allLocked = Boolean(
    preset.format && preset.size && preset.maxBytes !== undefined,
  );
  const anyLocked = Boolean(
    preset.format || preset.size || preset.maxBytes !== undefined,
  );
  const lock = (
    <LockKeyhole aria-label="预设锁定" className="image-dialog-lock-icon" />
  );
  return (
    <section
      ref={setPortalContainer}
      className="image-processor image-processor-dialog"
      aria-label="图片处理组件"
    >
      <div className="image-dialog-file">
        <div>
          <ImageIcon />
          <span title={image instanceof File ? image.name : undefined}>
            {image instanceof File ? image.name : "图片处理"}
          </span>
        </div>
        <span>本地处理 · 原图保留</span>
      </div>
      <div data-slot="image-workspace" className="image-dialog-workspace">
        {preview}
        <aside className="image-dialog-settings" aria-label="图片输出参数">
          <div className="image-dialog-settings-heading">
            <h3>输出设置</h3>
            <span>
              {allLocked
                ? "预设已锁定"
                : anyLocked
                  ? "部分参数锁定"
                  : "可自由调整"}
            </span>
          </div>
          <FieldGroup className="image-dialog-parameters">
            <Field
              orientation="horizontal"
              className="image-dialog-parameter"
              data-disabled={busy && !preset.format}
            >
              <FieldLabel id={`${id}-format-label`} htmlFor={`${id}-format`}>
                图片格式
              </FieldLabel>
              {preset.format ? (
                <output aria-labelledby={`${id}-format-label`}>
                  {
                    formats.find((option) => option.value === preset.format)
                      ?.label
                  }
                  {lock}
                </output>
              ) : (
                <Select<ImageFormat>
                  items={formats}
                  value={settings.format}
                  disabled={busy}
                  onValueChange={(value) => {
                    if (value) onChange({ format: value });
                  }}
                >
                  <SelectTrigger
                    id={`${id}-format`}
                    className="w-full"
                    title={
                      settings.format === "jpeg"
                        ? "JPEG 透明区域将以白色填充"
                        : undefined
                    }
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent portalContainer={portalContainer}>
                    <SelectGroup>
                      {formats.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field
              orientation="horizontal"
              className="image-dialog-parameter"
              data-disabled={busy && !preset.size}
            >
              <FieldLabel
                id={`${id}-size-label`}
                htmlFor={preset.size ? undefined : `${id}-resize`}
              >
                {!preset.size && (
                  <input
                    id={`${id}-resize`}
                    type="checkbox"
                    aria-label="指定输出宽高"
                    checked={settings.resize}
                    disabled={busy}
                    onChange={(event) =>
                      onChange({ resize: event.target.checked })
                    }
                  />
                )}
                输出尺寸
              </FieldLabel>
              {preset.size ? (
                <output aria-labelledby={`${id}-size-label`}>
                  {preset.size.width} × {preset.size.height} px{lock}
                </output>
              ) : (
                <div className="image-dialog-dimensions">
                  <Input
                    aria-label="宽度 / px"
                    type="number"
                    min="1"
                    max="16384"
                    value={settings.width}
                    disabled={busy || !settings.resize}
                    onChange={(event) =>
                      onChange({ width: event.target.value })
                    }
                  />
                  <span>×</span>
                  <Input
                    aria-label="高度 / px"
                    type="number"
                    min="1"
                    max="16384"
                    value={settings.height}
                    disabled={busy || !settings.resize}
                    onChange={(event) =>
                      onChange({ height: event.target.value })
                    }
                  />
                  <span>px</span>
                </div>
              )}
            </Field>
            <Field
              orientation="horizontal"
              className="image-dialog-parameter"
              data-disabled={busy && preset.maxBytes === undefined}
            >
              <FieldLabel id={`${id}-limit-label`} htmlFor={`${id}-limit`}>
                体积上限
              </FieldLabel>
              {preset.maxBytes !== undefined ? (
                <output aria-labelledby={`${id}-limit-label`}>
                  {preset.maxBytes / 1024} KiB{lock}
                </output>
              ) : (
                <div className="image-dialog-limit">
                  <Input
                    id={`${id}-limit`}
                    aria-label="文件体积上限"
                    type="number"
                    min="0.001"
                    max="20480"
                    step="any"
                    value={settings.maxKiB}
                    placeholder="不限"
                    disabled={busy}
                    onChange={(event) =>
                      onChange({ maxKiB: event.target.value })
                    }
                  />
                  <span>KiB</span>
                </div>
              )}
            </Field>
          </FieldGroup>
          <p className="image-dialog-help">
            {!preset.size && (
              <>
                取消尺寸：保留原图或选区像素
                <br />
              </>
            )}
            {preset.maxBytes === undefined
              ? "体积留空：不限制"
              : settings.format === "jpeg"
                ? "JPEG 透明区域以白色填充"
                : "无法满足体积上限时将阻止确认"}
          </p>
          <Separator />
          <div>
            <div className="image-dialog-crop-row">
              <label>
                <input
                  type="checkbox"
                  checked={settings.cropping}
                  disabled={busy || settings.resize}
                  onChange={(event) =>
                    onChange({ cropping: event.target.checked })
                  }
                />
                启用裁剪
              </label>
              <span>{settings.resize ? "按输出比例" : "自由取景"}</span>
            </div>
            <p className="image-dialog-help">拖动或缩放选区，调整取景</p>
          </div>
          {upscaled && (
            <Alert role="status" className="image-dialog-warning">
              <AlertTriangle />
              <AlertDescription>
                选区小于输出尺寸，将放大图片
                <br />
                清晰度可能下降
              </AlertDescription>
            </Alert>
          )}
          <Separator />
          {settings.format !== "png" ? (
            <div>
              <label
                className="image-dialog-quality-label"
                htmlFor={`${id}-quality`}
              >
                优先画质<output>{settings.quality}</output>
              </label>
              <input
                id={`${id}-quality`}
                aria-label="优先画质"
                type="range"
                min="60"
                max="100"
                step="1"
                value={settings.quality}
                disabled={busy}
                onChange={(event) =>
                  onChange({ quality: Number(event.target.value) })
                }
                className="image-dialog-quality"
              />
              <p className="image-dialog-help">
                体积受限时自动降低质量，最低 60
              </p>
            </div>
          ) : (
            <p className="image-dialog-help">
              PNG 优先无损优化，必要时尝试减色
              <br />
              明显色差的结果会被拒绝
            </p>
          )}
          <div className="image-dialog-result" aria-live="polite">
            {error ? (
              <>
                <Alert variant="destructive">
                  <AlertDescription>
                    <span className="line-clamp-2">{error}</span>
                  </AlertDescription>
                </Alert>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="link" size="xs">
                      查看完整错误
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogTitle>图片操作失败</DialogTitle>
                    <DialogDescription className="max-h-[60dvh] overflow-auto whitespace-pre-wrap break-words">
                      {error}
                    </DialogDescription>
                  </DialogContent>
                </Dialog>
              </>
            ) : busy ? (
              <p role="status" className="flex items-center gap-2">
                <LoaderCircle className="animate-spin" />
                正在编码并验证结果…
              </p>
            ) : (
              <dl>
                <dt>原图</dt>
                <dd>
                  {info.width} × {info.height} · {imageSizeLabel(info.byteSize)}
                </dd>
                <dt>处理结果</dt>
                <dd
                  title={
                    processed
                      ? `${processed.result.format.toUpperCase()} · ${processed.lossy ? `有损编码${processed.quality ? ` / 质量 ${processed.quality}` : ""}` : "无损编码"}`
                      : undefined
                  }
                >
                  {processed
                    ? `${processed.result.width} × ${processed.result.height} · ${imageSizeLabel(processed.result.byteSize)}`
                    : "待生成预览"}
                </dd>
              </dl>
            )}
          </div>
        </aside>
      </div>
      <footer className="image-dialog-actions">
        <div>
          <Button variant="ghost" onClick={onReset}>
            <RotateCcw data-icon="inline-start" />
            重置
          </Button>
          <span>{confirmationHint}</span>
        </div>
        <div>
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button
            variant={processed ? "outline" : "default"}
            disabled={busy}
            onClick={onProcess}
          >
            {busy ? "正在处理…" : "处理预览"}
          </Button>
          <Button disabled={busy || !processed} onClick={onConfirm}>
            <Check data-icon="inline-start" />
            确认结果
          </Button>
        </div>
      </footer>
    </section>
  );
}
