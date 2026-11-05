import { ScrollArea } from "@/components/ui/scroll-area";
import { isAndroid, isDemo } from "@/lib/platform";
import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ImageProcessor, type ImageProcessorResult } from "@/features/images";
import {
  MAX_IMAGE_SIZE,
  type ImageProcessorPreset,
} from "@/features/images/model";
import {
  imageFieldLabels,
  type MaterialImageField,
} from "@/features/image-presets/model";
import { imagePresetsService } from "@/features/image-presets/service";
import { onClientInvalidated } from "@/services/tauri/client";
import type { PromoteInput } from "@/types/cms";

type Work = {
  id: number;
  file: File;
  field: MaterialImageField;
  channel: string;
  subChannel: string;
  preset?: ImageProcessorPreset;
  loading: boolean;
  uploading: boolean;
  error: string | null;
};
const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : "图片操作失败，请重试";

export function useMaterialImage(
  input: PromoteInput,
  busy: boolean,
  onChange: (input: PromoteInput) => void,
  onWorking: (value: boolean) => void,
) {
  const [work, setWork] = useState<Work | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const active = useRef(false);
  const uploadGate = useRef(false);
  const presetRead = useRef<number | null>(null);
  const mounted = useRef(true);
  const focusTarget = useRef<HTMLElement | null>(null);
  const latest = useRef({ input, onChange, onWorking });
  latest.current = { input, onChange, onWorking };
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = onClientInvalidated(() => {
      generation.current += 1;
      active.current = false;
      uploadGate.current = false;
      presetRead.current = null;
      setWork(null);
      latest.current.onWorking(false);
    });
    return () => {
      mounted.current = false;
      generation.current += 1;
      active.current = false;
      unsubscribe();
    };
  }, []);
  const isCurrent = (id: number) =>
    mounted.current && active.current && generation.current === id;
  function close() {
    generation.current += 1;
    active.current = false;
    uploadGate.current = false;
    presetRead.current = null;
    setWork(null);
    latest.current.onWorking(false);
  }
  async function loadPreset(next: Work) {
    if (presetRead.current === next.id) return;
    presetRead.current = next.id;
    setWork({ ...next, loading: true, error: null });
    try {
      const preset = await imagePresetsService.resolve(
        next.channel,
        next.subChannel,
        next.field,
      );
      if (isCurrent(next.id))
        setWork({ ...next, preset, loading: false, error: null });
    } catch (reason) {
      if (isCurrent(next.id))
        setWork({
          ...next,
          loading: false,
          error: `图片预设读取失败：${message(reason)}`,
        });
    } finally {
      if (isCurrent(next.id)) presetRead.current = null;
    }
  }
  function start(file: File | undefined, field: MaterialImageField) {
    if (!file || active.current || busy) return;
    if (
      !file.size ||
      file.size > MAX_IMAGE_SIZE ||
      (file.type &&
        !["image/jpeg", "image/png", "image/webp"].includes(file.type))
    ) {
      setError("请选择不超过 20 MiB 的静态 JPG、PNG 或 WebP 图片");
      return;
    }
    active.current = true;
    uploadGate.current = false;
    setError(null);
    focusTarget.current = document.getElementById(`material-${field}`);
    latest.current.onWorking(true);
    void loadPreset({
      id: ++generation.current,
      file,
      field,
      channel: input.channel,
      subChannel: input.subChannel ?? "",
      loading: true,
      uploading: false,
      error: null,
    });
  }
  function paste(
    event: ClipboardEvent<HTMLInputElement>,
    field: MaterialImageField,
  ) {
    if (document.activeElement !== event.currentTarget) return;
    const item = Array.from(event.clipboardData.items).find(
      (entry) => entry.kind === "file" && entry.type.startsWith("image/"),
    );
    if (!item) return;
    event.preventDefault();
    start(item.getAsFile() ?? undefined, field);
  }
  async function confirm(result: ImageProcessorResult) {
    if (
      !work?.preset ||
      work.loading ||
      !isCurrent(work.id) ||
      uploadGate.current
    )
      return;
    const current = work;
    uploadGate.current = true;
    setWork({ ...current, uploading: true, error: null });
    try {
      const uploaded = await imagePresetsService.upload(result, work.preset);
      if (!isCurrent(current.id)) return;
      const value = latest.current.input;
      if (
        value.channel !== current.channel ||
        (value.subChannel ?? "") !== current.subChannel
      ) {
        setError("渠道已变化，图片未回填，请重新选择图片");
      } else
        latest.current.onChange({ ...value, [current.field]: uploaded.url });
      close();
    } catch (reason) {
      if (isCurrent(current.id))
        setWork({ ...current, uploading: false, error: message(reason) });
    } finally {
      if (isCurrent(current.id)) uploadGate.current = false;
    }
  }
  const content = work && (
    <>
      {work.loading ? (
        <div
          className={
            isAndroid()
              ? "flex flex-col items-center gap-4 overflow-y-auto py-8 text-center"
              : "space-y-4 py-8 text-center"
          }
        >
          <p role="status">正在读取子渠道图片预设…</p>
          <Button variant="outline" onClick={close}>
            取消图片处理
          </Button>
        </div>
      ) : work.preset ? (
        <div className={isAndroid() ? "relative min-h-0 flex-1" : "relative"}>
          <div
            data-slot={isAndroid() ? "channel-image-editor" : undefined}
            inert={work.uploading}
            className={isAndroid() ? "h-full min-h-0" : undefined}
          >
            <ImageProcessor
              image={work.file}
              preset={work.preset}
              onConfirm={(result) => void confirm(result)}
              onCancel={close}
            />
          </div>
          {work.uploading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl bg-background/90">
              <p role="status">
                {isDemo() ? "正在保存本机演示图片…" : "正在上传处理后的图片…"}
              </p>
              <Button variant="outline" onClick={close}>
                取消回填
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className={isAndroid() ? "flex flex-wrap gap-2" : "flex gap-2"}>
          <Button onClick={() => void loadPreset(work)}>重试读取预设</Button>
          <Button variant="outline" onClick={close}>
            取消图片处理
          </Button>
        </div>
      )}
      {work.error && (
        <p
          role="alert"
          className={
            isAndroid()
              ? "max-h-[25dvh] shrink-0 overflow-y-auto text-sm break-words text-destructive"
              : "text-sm text-destructive"
          }
        >
          {work.error}
        </p>
      )}
    </>
  );
  return {
    working: work !== null,
    error,
    start,
    paste,
    dialog: (
      <Dialog
        open={!!work}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent
          data-channel-dialog={isAndroid() ? "image" : undefined}
          className="flex max-h-[95dvh] flex-col overflow-hidden sm:max-w-6xl"
          onInteractOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (focusTarget.current?.isConnected) {
              const target = isAndroid()
                ? focusTarget.current.closest<HTMLElement>(
                    '[data-channel-dialog="edit"]',
                  )
                : focusTarget.current;
              target?.focus({ preventScroll: true });
            }
          }}
        >
          <DialogTitle>
            处理{" "}
            {work
              ? isAndroid()
                ? work.field === "titlePic"
                  ? "主图"
                  : "第二张图片"
                : imageFieldLabels[work.field]
              : "素材图片"}
          </DialogTitle>
          <DialogDescription>
            {work?.channel || "未选择渠道"} /{" "}
            {work?.subChannel || "未选择子渠道"} ·
            {isDemo()
              ? "演示：确认后存入本机，保存后关联演示素材。"
              : "确认结果后上传，保存素材后才关联。已配置的参数锁定。"}
          </DialogDescription>
          {isAndroid() ? (
            // 仅参数工作区滚动，避免外层 ScrollArea 带走底部操作。
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
              {content}
            </div>
          ) : (
            <ScrollArea
              className="-mx-1 flex-1"
              viewportProps={{ className: "px-1 py-1" }}
            >
              {content}
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    ),
  };
}
