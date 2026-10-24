import { useEffect, useRef, useState } from "react";
import { ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { SearchableSelect } from "@/components/common/SearchableSelect";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { channelService } from "@/features/channels/service";
import {
  imagePresetSchema,
  type ImageFormat,
  type ImageProcessorPreset,
} from "@/features/images/model";
import type { ChannelGroup } from "@/types/cms";
import {
  emptyPresets,
  hasPreset,
  imageFields,
  imageFieldLabels,
  type ChannelImagePresets,
  type MaterialImageField,
} from "./model";
import { imagePresetsService } from "./service";

type Draft = {
  width: string;
  height: string;
  maxKiB: string;
  format: ImageFormat | "";
};
type DraftPair = Record<MaterialImageField, Draft>;
const blank = (): Draft => ({ width: "", height: "", maxKiB: "", format: "" });
const toDraft = (preset: ImageProcessorPreset): Draft => ({
  width: preset.size ? String(preset.size.width) : "",
  height: preset.size ? String(preset.size.height) : "",
  maxKiB: preset.maxBytes === undefined ? "" : String(preset.maxBytes / 1024),
  format: preset.format ?? "",
});
function fromDraft(draft: Draft, field: MaterialImageField) {
  if (!!draft.width.trim() !== !!draft.height.trim())
    throw new Error(`${imageFieldLabels[field]} 的宽、高必须成对填写`);
  const parsed = imagePresetSchema.safeParse({
    size: draft.width.trim()
      ? { width: Number(draft.width), height: Number(draft.height) }
      : undefined,
    maxBytes: draft.maxKiB.trim()
      ? Math.round(Number(draft.maxKiB) * 1024)
      : undefined,
    format: draft.format || undefined,
  });
  if (!parsed.success)
    throw new Error(
      `${imageFieldLabels[field]}：宽高须为正整数，单边不超过 16384 px、总像素不超过 2400 万；体积上限须大于零且不超过 20480 KiB`,
    );
  return parsed.data;
}
const formats = [
  { value: "", label: "不限制（默认源格式）" },
  { value: "jpeg", label: "JPG / JPEG" },
  { value: "png", label: "PNG" },
  { value: "webp", label: "WebP" },
];

export function ImagePresetSettings() {
  const [groups, setGroups] = useState<ChannelGroup[]>([]);
  const [configs, setConfigs] = useState<ChannelImagePresets[]>([]);
  const [channel, setChannel] = useState("");
  const [subChannel, setSubChannel] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DraftPair>>({});
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const mounted = useRef(true);
  const savingGate = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setGroupsError(null);
    void Promise.allSettled([
      Promise.resolve().then(() => channelService.groups()),
      imagePresetsService.list(),
    ]).then(([channels, presets]) => {
      if (!active) return;
      if (channels.status === "fulfilled") setGroups(channels.value);
      else setGroupsError("渠道列表加载失败，可重试；仍可编辑已保存的预设。");
      if (presets.status === "fulfilled") {
        setConfigs(presets.value);
        setReady(true);
      } else {
        setReady(false);
        setError("图片预设读取失败，请重试。");
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [retry]);
  const key = JSON.stringify([channel, subChannel]);
  const config =
    configs.find(
      (entry) => entry.channel === channel && entry.subChannel === subChannel,
    ) ?? emptyPresets(channel, subChannel);
  const draft = drafts[key] ?? {
    titlePic: toDraft(config.titlePic),
    titlePic2: toDraft(config.titlePic2),
  };
  const channelNames = [
    ...new Set([
      ...groups.map((group) => group.channel),
      ...configs.map((entry) => entry.channel),
    ]),
  ];
  const subChannels = [
    ...new Set([
      ...(groups.find((group) => group.channel === channel)?.subchannels ?? []),
      ...configs
        .filter((entry) => entry.channel === channel)
        .map((entry) => entry.subChannel),
    ]),
  ].filter(Boolean);
  const disabled = loading || saving || !ready;
  function change(field: MaterialImageField, next: Draft) {
    setDrafts((previous) => ({
      ...previous,
      [key]: { ...draft, [field]: next },
    }));
    setError(null);
  }
  async function save() {
    if (disabled || savingGate.current || !channel || !subChannel) return;
    try {
      const request = {
        channel,
        subChannel,
        titlePic: fromDraft(draft.titlePic, "titlePic"),
        titlePic2: fromDraft(draft.titlePic2, "titlePic2"),
      };
      savingGate.current = true;
      setSaving(true);
      setError(null);
      const saved = await imagePresetsService.save(request);
      if (!mounted.current) return;
      setConfigs((previous) => [
        ...previous.filter(
          (entry) =>
            entry.channel !== channel || entry.subChannel !== subChannel,
        ),
        ...(hasPreset(saved.titlePic) || hasPreset(saved.titlePic2)
          ? [saved]
          : []),
      ]);
      setDrafts((previous) => {
        const next = { ...previous };
        delete next[key];
        return next;
      });
      toast.success("子渠道图片预设已保存");
    } catch (reason) {
      if (mounted.current)
        setError(
          reason instanceof Error ? reason.message : "预设保存失败，请重试",
        );
    } finally {
      savingGate.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return (
    <Card className="shadow-none xl:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ImageIcon className="size-4" />
          子渠道图片预设
        </CardTitle>
        <CardDescription>
          TitlePic、TitlePic2
          分别设置。已配置项在图片处理时锁定，留空项可自行调整。本机工作区共用，重启后保留。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="preset-channel">预设渠道</label>
            <SearchableSelect
              id="preset-channel"
              aria-label="预设渠道"
              options={channelNames.map((value) => ({ value, label: value }))}
              value={channel}
              onValueChange={(value) => {
                setChannel(value);
                setSubChannel("");
                setError(null);
              }}
              disabled={disabled}
              searchPlaceholder="搜索预设渠道…"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="preset-subchannel">预设子渠道</label>
            <SearchableSelect
              id="preset-subchannel"
              aria-label="预设子渠道"
              options={subChannels.map((value) => ({ value, label: value }))}
              value={subChannel}
              onValueChange={(value) => {
                setSubChannel(value);
                setError(null);
              }}
              disabled={disabled || !channel}
              searchPlaceholder="搜索预设子渠道…"
            />
          </div>
        </div>
        {loading && <p role="status">正在读取图片预设…</p>}
        {groupsError && (
          <p role="status" className="text-muted-foreground">
            {groupsError}
          </p>
        )}
        {(groupsError || !ready) && !loading && (
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => setRetry((value) => value + 1)}
          >
            重新读取预设与渠道
          </Button>
        )}
        {channel && subChannel && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            className="space-y-4"
            noValidate
          >
            <div className="grid gap-4 lg:grid-cols-2">
              {imageFields.map((field) => (
                <fieldset
                  key={field}
                  disabled={disabled}
                  className="space-y-3 rounded-lg border p-4"
                >
                  <legend className="px-1 font-medium">
                    {imageFieldLabels[field]}
                  </legend>
                  <div className="grid grid-cols-2 gap-3">
                    {(["width", "height"] as const).map((dimension) => (
                      <div key={dimension} className="space-y-1">
                        <label htmlFor={`${field}-${dimension}`}>
                          {dimension === "width" ? "宽" : "高"}（px）
                        </label>
                        <Input
                          id={`${field}-${dimension}`}
                          aria-label={`${imageFieldLabels[field]} ${dimension === "width" ? "宽" : "高"}（px）`}
                          type="number"
                          min="1"
                          max="16384"
                          step="1"
                          placeholder="不限制"
                          value={draft[field][dimension]}
                          onChange={(event) =>
                            change(field, {
                              ...draft[field],
                              [dimension]: event.target.value,
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1">
                    <label htmlFor={`${field}-bytes`}>体积上限（KiB）</label>
                    <Input
                      id={`${field}-bytes`}
                      aria-label={`${imageFieldLabels[field]} 体积上限（KiB）`}
                      type="number"
                      min="0"
                      max="20480"
                      step="any"
                      placeholder="不限制"
                      value={draft[field].maxKiB}
                      onChange={(event) =>
                        change(field, {
                          ...draft[field],
                          maxKiB: event.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor={`${field}-format`}>输出格式</label>
                    <Select
                      items={formats}
                      value={draft[field].format}
                      onValueChange={(value) => {
                        if (value !== null)
                          change(field, {
                            ...draft[field],
                            format: value as Draft["format"],
                          });
                      }}
                      disabled={disabled}
                    >
                      <SelectTrigger
                        id={`${field}-format`}
                        aria-label={`${imageFieldLabels[field]} 输出格式`}
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {formats.map((format) => (
                          <SelectItem key={format.value} value={format.value}>
                            {format.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => change(field, blank())}
                  >
                    清空 {imageFieldLabels[field]} 预设
                  </Button>
                </fieldset>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              清空后点击保存才生效。尺寸单边最多 16384 px，总像素最多 2400
              万，体积上限最多 20480 KiB。
            </p>
            <Button type="submit" disabled={disabled}>
              {saving ? "正在保存预设…" : "保存图片预设"}
            </Button>
          </form>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
