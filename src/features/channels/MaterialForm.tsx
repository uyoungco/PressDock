import { isAndroid, isDemo } from "@/lib/platform";
import { focusOverlayContent } from "@/lib/overlay-focus";
import { useState } from "react";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
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
  presentation = "dialog",
}: {
  presentation?: "dialog" | "channel-sheet";
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
  const mobile = useIsMobile();
  const sheet = presentation === "channel-sheet" && !isAndroid() && !mobile;
  const image = useMaterialImage(
    edit.input,
    busy,
    onChange,
    onUploading,
    isAndroid() || sheet,
  );
  const Root = sheet ? Sheet : Dialog;
  const Content = sheet ? SheetContent : DialogContent;
  const Header = sheet ? SheetHeader : DialogHeader;
  const Title = sheet ? SheetTitle : DialogTitle;
  const Description = sheet ? SheetDescription : DialogDescription;
  const Footer = sheet ? SheetFooter : DialogFooter;
  // 共用弹窗保持原顺序；渠道桌面抽屉在下方按编辑任务分组。
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
  const renderField = (field: keyof PromoteInput) => {
    const label =
      isAndroid() || sheet
        ? mobileLabels[field]
        : field[0].toUpperCase() + field.slice(1);
    const picture = field === "titlePic" || field === "titlePic2";
    return (
      <Field key={field}>
        <FieldLabel htmlFor={`material-${field}`}>
          {["channel", "title", "titlePic"].includes(field) ? "* " : ""}
          {label}
        </FieldLabel>
        {(isAndroid() || sheet) && picture && (
          <div
            className={
              sheet
                ? "flex flex-wrap items-center gap-2"
                : "flex items-center gap-3"
            }
          >
            <MaterialImage
              compact
              density={sheet ? "table" : "default"}
              url={edit.input[field]}
              label={label}
            />
            <Button asChild variant="outline" disabled={busy || image.working}>
              <label htmlFor={`material-${field}-file`}>
                {edit.input[field] ? "更换图片" : "选择图片"}
              </label>
            </Button>
          </div>
        )}
        {/* 文章转素材从真实配置选择；子渠道铺满表单行，避免长名称被过早截断。 */}
        {channels && (field === "channel" || field === "subChannel") ? (
          <SearchableSelect
            className={cn(
              (isAndroid() || sheet || field === "subChannel") && "w-full",
            )}
            wrapLabels={sheet}
            portalContainer={portalContainer}
            id={`material-${field}`}
            value={edit.input[field] ?? ""}
            options={(field === "channel"
              ? channels.groups.map((group) => group.channel)
              : (channels.groups.find(
                  (group) => group.channel === edit.input.channel,
                )?.subchannels ?? [])
            ).map((value) => ({ value, label: value }))}
            placeholder={field === "channel" ? "选择渠道" : "选择子渠道"}
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
            rows={sheet ? 3 : undefined}
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
                  ["channel", "subChannel", "titlePic", "titlePic2"].includes(
                    field,
                  ))
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
            {/* Android 复用标题服务；采用只回填表单，保存素材才提交 CMS。 */}
            {field === "title" && (
              <TitleOptimizer
                title={edit.input.title}
                content={edit.input.smallText ?? ""}
                disabled={busy || image.working}
                titleInputId="material-title"
                onAdopt={(title) => onChange({ ...edit.input, title })}
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
              isAndroid() || sheet
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
  };
  return (
    <Root
      open
      onOpenChange={(open) => {
        if (!open && !busy && !image.working) onClose();
      }}
    >
      {/* 外壳只裁剪，滚动由内部 ScrollArea 承担，避免选项 scrollIntoView 横移整个弹层。 */}
      <Content
        ref={setPortalContainer}
        data-channel-dialog={isAndroid() ? "edit" : undefined}
        data-channel-sheet={sheet ? "" : undefined}
        className={
          sheet
            ? "channel-workspace flex flex-col gap-0 overflow-clip data-[side=right]:w-[560px] data-[side=right]:max-w-full data-[side=right]:sm:max-w-[560px]"
            : "flex max-h-[85dvh] flex-col overflow-clip sm:max-w-2xl max-md:top-0 max-md:left-0 max-md:h-dvh max-md:max-h-dvh max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none"
        }
        showCloseButton={!busy && !image.working}
        onOpenAutoFocus={focusOverlayContent}
        onEscapeKeyDown={(event) => {
          // Base UI 菜单由自身关闭，避免 Radix 的捕获监听先关闭整个表单。
          if (
            portalContainer?.querySelector(
              '[data-slot="combobox-trigger"][aria-expanded="true"]',
            )
          )
            event.preventDefault();
        }}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <Header className={cn("shrink-0 pr-12", sheet && "border-b p-4 pr-12")}>
          <Title>{title ?? (edit.base ? "修改素材" : "新增素材")}</Title>
          <Description>
            {isDemo()
              ? "演示数据：图片仅存入本机，保存后关联演示素材。"
              : "带 * 的字段必填。上传图片只回填地址，保存后才关联素材。"}
          </Description>
        </Header>
        <ScrollArea className={sheet ? "min-h-0 flex-1" : "-mx-1 flex-1"}>
          <form
            id="material-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!image.working && !busy) onSave();
            }}
            noValidate
            className={
              sheet
                ? "flex flex-col gap-4 p-4"
                : "flex flex-col gap-4 px-1 py-1"
            }
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
            <FieldGroup className={sheet ? "gap-5" : undefined}>
              {sheet
                ? [
                    {
                      title: "标题与摘要",
                      fields: ["title", "smallText"] as const,
                    },
                    {
                      title: "配图",
                      fields: ["titlePic", "titlePic2"] as const,
                      pictures: true,
                    },
                    {
                      title: "目标渠道",
                      fields: ["channel", "subChannel", "publishDate"] as const,
                    },
                    { title: "来源信息", fields: ["writer", "url"] as const },
                  ].map((section) => (
                    <FieldSet key={section.title} className="gap-3">
                      <FieldLegend variant="label">{section.title}</FieldLegend>
                      <FieldGroup
                        className={cn(
                          "gap-3",
                          section.pictures && "grid grid-cols-2 items-start",
                        )}
                      >
                        {section.fields.map(renderField)}
                      </FieldGroup>
                    </FieldSet>
                  ))
                : fields.map(renderField)}
            </FieldGroup>
            {(error || image.error) && (
              <p role="alert" className="text-sm text-destructive">
                {error || image.error}
              </p>
            )}
          </form>
        </ScrollArea>
        {draftStatus && (
          <p
            role="status"
            className={cn(
              "text-sm text-muted-foreground",
              sheet && "px-4 py-2",
            )}
          >
            {draftStatus}
          </p>
        )}
        {/* 手机操作并排，避免双行按钮占用正文高度。 */}
        <Footer
          className={cn(
            "shrink-0",
            isAndroid() && "flex-row rounded-none p-3",
            sheet && "mt-0 flex-row justify-end border-t p-4",
          )}
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
            {busy ? "正在保存…" : sheet ? "保存渠道素材" : "保存素材"}
          </Button>
        </Footer>
        {image.dialog}
      </Content>
    </Root>
  );
}
