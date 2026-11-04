import { isAndroid, isDemo } from "@/lib/platform";
import { useState } from "react";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { MaterialImage } from "./MaterialImage";
import { cn } from "cn";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMaterialImage } from "./use-material-image";
import type { MaterialEdit } from "./edit-buffer";
import type { PromoteInput } from "@/types/cms";
import { SearchableSelect } from "@/components/common/SearchableSelect";
import type { ChannelGroup } from "@/types/cms";
import { TitleOptimizer } from "@/features/ai/TitleOptimizer";

export function MaterialForm({
  edit,
  onChange,
  onClose,
  onSave,
  busy,
  onUploading,
  error,
  channels,
  title,
  draftStatus,
}: {
  title?: string;
  draftStatus?: string | null;
  channels?: {
    groups: ChannelGroup[];
    loading: boolean;
    error: string | null;
    retry: () => void;
  };
  edit: MaterialEdit;
  onChange: (input: PromoteInput) => void;
  onClose: () => void;
  onSave: () => void;
  busy: boolean;
  onUploading: (value: boolean) => void;
  error: string | null;
}) {
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const image = useMaterialImage(edit.input, busy, onChange, onUploading);
  // 手机先编辑标题与图片；桌面保留现有字段顺序。
  const fields: (keyof PromoteInput)[] = isAndroid()
    ? [
        "title",
        "channel",
        "subChannel",
        "publishDate",
        "titlePic",
        "titlePic2",
        "smallText",
        "writer",
        "url",
      ]
    : [
        "channel",
        "subChannel",
        "publishDate",
        "url",
        "title",
        "titlePic",
        "titlePic2",
        "smallText",
        "writer",
      ];
  const mobileLabels: Record<keyof PromoteInput, string> = {
    channel: "渠道",
    subChannel: "子渠道",
    publishDate: "发布日期",
    url: "文章链接",
    title: "标题",
    titlePic: "主图地址",
    titlePic2: "第二张图片地址",
    smallText: "摘要",
    writer: "作者",
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy && !image.working) onClose();
      }}
    >
      <DialogContent
        ref={setPortalContainer}
        data-mobile-fullscreen={isAndroid() || undefined}
        className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-2xl max-md:top-0 max-md:left-0 max-md:h-dvh max-md:max-h-dvh max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none"
        showCloseButton={!busy && !image.working}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>
            {title ?? (edit.base ? "修改素材" : "新增素材")}
          </DialogTitle>
          <DialogDescription>
            {isDemo()
              ? "演示数据：图片仅存入本机，保存后关联演示素材。"
              : "带 * 的字段必填。上传图片只回填地址，保存后才关联素材。"}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="-mx-1 flex-1">
          <form
            id="material-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!image.working && !busy) onSave();
            }}
            noValidate
            className="flex flex-col gap-4 px-1 py-1"
          >
            {channels?.error && (
              <p role="alert" className="text-destructive">
                {channels.error}
                <Button
                  type="button"
                  variant="outline"
                  onClick={channels.retry}
                >
                  重试渠道配置
                </Button>
              </p>
            )}
            {channels?.loading && <p role="status">正在读取渠道配置…</p>}
            <FieldGroup>
              {fields.map((field) => {
                const label = isAndroid()
                  ? mobileLabels[field]
                  : field[0].toUpperCase() + field.slice(1);
                const picture = field === "titlePic" || field === "titlePic2";
                return (
                  <Field key={field}>
                    <FieldLabel htmlFor={`material-${field}`}>
                      {["channel", "title", "titlePic"].includes(field)
                        ? "* "
                        : ""}
                      {label}
                    </FieldLabel>
                    {isAndroid() && picture && (
                      <div className="flex items-center gap-3">
                        <MaterialImage
                          compact
                          url={edit.input[field]}
                          label={label}
                        />
                        <Button
                          asChild
                          variant="outline"
                          disabled={busy || image.working}
                        >
                          <label htmlFor={`material-${field}-file`}>
                            {edit.input[field] ? "更换图片" : "选择图片"}
                          </label>
                        </Button>
                      </div>
                    )}
                    {/* 文章转素材从真实配置选择；子渠道铺满表单行，避免长名称被过早截断。 */}
                    {channels &&
                    (field === "channel" || field === "subChannel") ? (
                      <SearchableSelect
                        className={cn(
                          (isAndroid() || field === "subChannel") && "w-full",
                        )}
                        portalContainer={portalContainer}
                        id={`material-${field}`}
                        value={edit.input[field] ?? ""}
                        options={(field === "channel"
                          ? channels.groups.map((group) => group.channel)
                          : (channels.groups.find(
                              (group) => group.channel === edit.input.channel,
                            )?.subchannels ?? [])
                        ).map((value) => ({ value, label: value }))}
                        placeholder={
                          field === "channel" ? "选择渠道" : "选择子渠道"
                        }
                        disabled={
                          busy ||
                          image.working ||
                          channels.loading ||
                          !!channels.error ||
                          (field === "subChannel" &&
                            !channels.groups.find(
                              (group) => group.channel === edit.input.channel,
                            )?.subchannels.length)
                        }
                        onValueChange={(value) =>
                          onChange(
                            field === "channel"
                              ? {
                                  ...edit.input,
                                  channel: value,
                                  subChannel: "",
                                }
                              : { ...edit.input, subChannel: value },
                          )
                        }
                      />
                    ) : field === "smallText" ? (
                      <Textarea
                        id={`material-${field}`}
                        value={edit.input[field] ?? ""}
                        disabled={busy}
                        onChange={(e) =>
                          onChange({ ...edit.input, [field]: e.target.value })
                        }
                      />
                    ) : (
                      <div className="flex items-start gap-2">
                        <Input
                          id={`material-${field}`}
                          type={field === "publishDate" ? "date" : "text"}
                          value={edit.input[field] ?? ""}
                          disabled={
                            busy ||
                            (image.working &&
                              [
                                "channel",
                                "subChannel",
                                "titlePic",
                                "titlePic2",
                              ].includes(field))
                          }
                          onPaste={
                            field === "titlePic" || field === "titlePic2"
                              ? (event) => image.paste(event, field)
                              : undefined
                          }
                          onChange={(e) =>
                            onChange({ ...edit.input, [field]: e.target.value })
                          }
                        />
                        {field === "title" && !isAndroid() && (
                          <TitleOptimizer
                            title={edit.input.title}
                            content={edit.input.smallText ?? ""}
                            disabled={busy || image.working}
                            titleInputId="material-title"
                            onAdopt={(title) =>
                              onChange({ ...edit.input, title })
                            }
                          />
                        )}
                      </div>
                    )}
                    {(field === "titlePic" || field === "titlePic2") && (
                      <input
                        id={`material-${field}-file`}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        aria-label={`上传 ${label}`}
                        disabled={busy || image.working}
                        className={
                          isAndroid()
                            ? "sr-only"
                            : "block max-w-full text-xs file:mr-3 file:rounded-md file:border file:bg-secondary file:px-3 file:py-2"
                        }
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          image.start(file, field);
                        }}
                      />
                    )}
                  </Field>
                );
              })}
            </FieldGroup>
            {(error || image.error) && (
              <p role="alert" className="text-sm text-destructive">
                {error || image.error}
              </p>
            )}
          </form>
        </ScrollArea>
        {draftStatus && (
          <p role="status" className="text-sm text-muted-foreground">
            {draftStatus}
          </p>
        )}
        {/* 手机操作并排，避免双行按钮占用正文高度。 */}
        <DialogFooter
          className={cn("shrink-0", isAndroid() && "flex-row rounded-none p-3")}
        >
          <Button
            variant="outline"
            className={isAndroid() ? "h-10 flex-1" : undefined}
            disabled={busy || image.working}
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            type="submit"
            className={isAndroid() ? "h-10 flex-[2]" : undefined}
            form="material-form"
            disabled={busy || image.working}
          >
            {busy ? "正在保存…" : "保存素材"}
          </Button>
        </DialogFooter>
        {image.dialog}
      </DialogContent>
    </Dialog>
  );
}
