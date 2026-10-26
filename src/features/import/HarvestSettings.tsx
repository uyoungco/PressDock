import { useEffect, useRef, useState, type FormEvent } from "react";
import { Save, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import { LoadState } from "@/components/common/LoadState";
import { aiService } from "@/features/ai/service";
import { aiErrorMessage } from "@/features/ai/use-settings";
import type { AiModelConfig } from "@/features/ai/contracts";
import {
  harvestSettingsSchema,
  type HarvestSettings as Settings,
} from "./contracts";
import { importService } from "./service";

const switches = [
  ["autoClassify", "AI 判断分类", "根据原文生成分类，校验后覆盖默认分类。"],
  ["autoTags", "AI 生成标签", "生成 3～5 个标签；失败时保留原值。"],
  [
    "autoSummary",
    "AI 生成摘要",
    "生成不超过 130 字符的简介；关闭时保留后台简介。",
  ],
  [
    "autoOrganize",
    "AI 正文整理",
    "按原文片段整理段落和图注，沿用首尾推广、署名清理规则。",
  ],
  [
    "autoPaginate",
    "自动内容分页",
    "按语义组或原段落本地分页；单独开启时无需调用 AI。",
  ],
] as const;

export function HarvestSettings({ active }: { active: boolean }) {
  const [form, setForm] = useState<Settings | null>(null);
  const [days, setDays] = useState("");
  const [models, setModels] = useState<AiModelConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modeSaving, setModeSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);
  const lock = useRef(false);
  useEffect(() => {
    if (!active) return;
    let valid = true;
    setLoading(true);
    // 标签切换只刷新模型列表，保留尚未保存的五项设置和保留天数。
    Promise.all([
      loaded.current ? Promise.resolve(null) : importService.settings(),
      aiService.load(),
    ])
      .then(([settings, ai]) => {
        if (!valid) return;
        if (settings) {
          setForm(settings);
          setDays(settings.retentionDays?.toString() ?? "");
          loaded.current = true;
        }
        setModels(ai.models);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (valid) setError(aiErrorMessage(reason));
      })
      .finally(() => {
        if (valid) setLoading(false);
      });
    return () => {
      valid = false;
    };
  }, [active]);
  async function setDeveloperMode(enabled: boolean) {
    if (!form || lock.current) return;
    lock.current = true;
    setModeSaving(true);
    setError(null);
    try {
      // 勾选状态以落库结果为准；单独保存模式，不提交其他未保存的 AI/保留期修改。
      const saved = await importService.setDeveloperMode(enabled);
      setForm((current) => current && { ...current, developerMode: saved });
      toast.success(
        saved
          ? "开发者模式已开启，可按 F12 打开 DevTools"
          : "开发者模式已关闭，仅影响之后新入队的任务",
      );
    } catch (reason) {
      setError(aiErrorMessage(reason));
    } finally {
      lock.current = false;
      setModeSaving(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || lock.current) return;
    lock.current = true;
    setSaving(true);
    setError(null);
    try {
      const request = harvestSettingsSchema.parse({
        ...form,
        retentionDays: days.trim() === "" ? null : Number(days),
      });
      await importService.saveSettings(request);
      setForm(request);
      toast.success("采集设置已保存，新的采集任务将使用这些设置");
    } catch (reason) {
      setError(aiErrorMessage(reason));
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return (
    <Card className="min-w-0 shadow-none">
      <CardHeader>
        <CardTitle>采集与 AI 处理</CardTitle>
        <CardDescription>
          链接入队后采集并处理，正常任务提交
          CMS，调试任务仅保存本地结果。已排队任务使用入队时保存的设置。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <LoadState loading={loading && !form} error={error} />
        {form && (
          <form onSubmit={save} className="flex flex-col gap-6">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                role="switch"
                className="mt-1 size-4 accent-primary"
                checked={form.developerMode}
                disabled={saving || modeSaving || loading}
                onChange={(event) =>
                  void setDeveloperMode(event.target.checked)
                }
              />
              <span className="flex flex-col gap-1">
                <span className="text-sm font-medium">开发者模式</span>
                {modeSaving && (
                  <span role="status" className="text-xs text-muted-foreground">
                    正在保存开发者模式…
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  开关即时保存，开启后按 F12 打开
                  DevTools，逐步打印业务数据。仍调用 CMS 格式化，但不创建 CMS
                  文章。
                </span>
                <span className="text-xs font-medium text-muted-foreground">
                  仅影响开启后新入队的任务；已有正常任务仍会提交
                  CMS。关闭后不会补交调试任务。
                </span>
              </span>
            </label>
            <fieldset
              className="flex flex-col gap-4"
              disabled={saving || modeSaving}
            >
              <legend className="mb-4 text-sm font-medium">AI 处理规则</legend>
              {switches.map(([key, label, hint]) => (
                <label key={key} className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    role="switch"
                    className="mt-1 size-4 accent-primary"
                    checked={form[key]}
                    onChange={(event) =>
                      setForm({ ...form, [key]: event.target.checked })
                    }
                  />
                  <span className="flex flex-col gap-1">
                    <span className="text-sm font-medium">{label}</span>
                    <span className="text-xs text-muted-foreground">
                      {hint}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="flex flex-col gap-2">
              <label htmlFor="harvest-model" className="text-sm font-medium">
                AI 处理模型
              </label>
              <Select<string>
                value={form.modelConfigId ?? ""}
                items={[
                  { value: "", label: "未配置（AI 步骤回退到后台结果）" },
                  ...models.map((model) => ({
                    value: model.id,
                    label: model.displayName,
                  })),
                ]}
                disabled={saving || modeSaving || loading}
                onValueChange={(value) => {
                  if (value !== null)
                    setForm({ ...form, modelConfigId: value || null });
                }}
              >
                <SelectTrigger id="harvest-model" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="">
                      未配置（AI 步骤回退到后台结果）
                    </SelectItem>
                    {models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.displayName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                复用“AI 模型”中的提供商和密钥。所有 AI 项关闭时不发送 AI 请求。
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <label
                htmlFor="harvest-retention"
                className="text-sm font-medium"
              >
                历史保留时间（天）
              </label>
              <Input
                id="harvest-retention"
                type="number"
                min={1}
                max={36500}
                step={1}
                value={days}
                onChange={(event) => setDays(event.target.value)}
                placeholder="留空表示永久保留"
                disabled={saving || modeSaving}
                className="max-w-sm"
              />
              <p className="text-xs text-muted-foreground">
                包含启动当天，留空永久保留。保存后在下次启动时清理过期终态记录；未完成和提交结果待确认的任务保留。不删除
                CMS 文章。
              </p>
            </div>
            <Button
              type="submit"
              disabled={saving || modeSaving || loading}
              className="self-start"
            >
              {saving ? (
                <LoaderCircle
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : (
                <Save data-icon="inline-start" />
              )}
              {saving ? "正在保存…" : "保存采集设置"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
