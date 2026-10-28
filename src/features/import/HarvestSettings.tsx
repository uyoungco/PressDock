import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
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
import { importService } from "./service";
import { ServiceError } from "@/services/tauri/client";

const autosave = importService.settingsAutosave;
function flushOnLeave() {
  void autosave.flush().catch((reason: unknown) => {
    if (reason instanceof ServiceError && reason.code === "SESSION_CHANGED")
      return;
    toast.error(`采集设置尚未保存：${aiErrorMessage(reason)}`);
  });
}

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
  const {
    form,
    days,
    retentionError,
    status,
    error: saveError,
    modeSaving,
  } = useSyncExternalStore(autosave.subscribe, autosave.getSnapshot);
  const [models, setModels] = useState<AiModelConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    let valid = true;
    setLoading(true);
    setError(null);
    Promise.allSettled([importService.settings(), aiService.load()])
      .then(([settings, ai]) => {
        if (!valid) return;
        if (ai.status === "fulfilled") setModels(ai.value.models);
        const failed =
          ai.status === "rejected"
            ? ai
            : settings.status === "rejected" && !autosave.getSnapshot().error
              ? settings
              : null;
        setError(failed ? aiErrorMessage(failed.reason) : null);
      })
      .finally(() => {
        if (valid) setLoading(false);
      });
    return () => {
      valid = false;
      flushOnLeave();
    };
  }, [active]);
  async function setDeveloperMode(enabled: boolean) {
    if (!form || lock.current) return;
    lock.current = true;
    setError(null);
    try {
      const saved = await importService.setDeveloperMode(enabled);
      if (!mounted.current) return;
      toast.success(
        saved
          ? "开发者模式已开启，可按 F12 打开 DevTools"
          : "开发者模式已关闭，仅影响之后新入队的任务",
      );
    } catch (reason) {
      if (mounted.current) setError(aiErrorMessage(reason));
    } finally {
      lock.current = false;
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
          <FieldGroup>
            <Field
              orientation="horizontal"
              data-disabled={modeSaving || loading}
            >
              <input
                id="harvest-developer-mode"
                type="checkbox"
                role="switch"
                className="mt-1 size-4 accent-primary"
                checked={form.developerMode}
                disabled={modeSaving || loading}
                onChange={(event) =>
                  void setDeveloperMode(event.target.checked)
                }
              />
              <FieldContent>
                <FieldLabel htmlFor="harvest-developer-mode">
                  开发者模式
                </FieldLabel>
                {modeSaving && (
                  <span role="status" className="text-xs text-muted-foreground">
                    正在保存开发者模式…
                  </span>
                )}
                <FieldDescription>
                  开关即时保存，开启后按 F12 打开
                  DevTools，逐步打印业务数据。仍调用 CMS 格式化，但不创建 CMS
                  文章。
                </FieldDescription>
                <FieldDescription>
                  仅影响开启后新入队的任务；已有正常任务仍会提交
                  CMS。关闭后不会补交调试任务。
                </FieldDescription>
              </FieldContent>
            </Field>
            <FieldSet>
              <FieldLegend variant="label">AI 处理规则</FieldLegend>
              <FieldGroup className="gap-4">
                {switches.map(([key, label, hint]) => (
                  <Field key={key} orientation="horizontal">
                    <input
                      id={`harvest-${key}`}
                      type="checkbox"
                      role="switch"
                      className="mt-1 size-4 accent-primary"
                      checked={form[key]}
                      onChange={(event) =>
                        autosave.update({ [key]: event.target.checked })
                      }
                    />
                    <FieldContent>
                      <FieldLabel htmlFor={`harvest-${key}`}>
                        {label}
                      </FieldLabel>
                      <FieldDescription>{hint}</FieldDescription>
                    </FieldContent>
                  </Field>
                ))}
              </FieldGroup>
            </FieldSet>
            <Field>
              <FieldLabel htmlFor="harvest-model">AI 处理模型</FieldLabel>
              <Select<string>
                value={form.modelConfigId ?? ""}
                items={[
                  { value: "", label: "未配置（AI 步骤回退到后台结果）" },
                  ...models.map((model) => ({
                    value: model.id,
                    label: model.displayName,
                  })),
                ]}
                disabled={loading}
                onValueChange={(value) => {
                  if (value !== null)
                    autosave.update({ modelConfigId: value || null });
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
              <FieldDescription>
                复用“AI 模型”中的提供商和密钥。所有 AI 项关闭时不发送 AI 请求。
              </FieldDescription>
            </Field>
            <Field data-invalid={Boolean(retentionError)}>
              <FieldLabel htmlFor="harvest-retention">
                历史保留时间（天）
              </FieldLabel>
              <Input
                id="harvest-retention"
                inputMode="numeric"
                value={days}
                onChange={(event) => autosave.updateDays(event.target.value)}
                placeholder="留空表示永久保留"
                aria-invalid={Boolean(retentionError)}
                aria-describedby={
                  retentionError
                    ? "harvest-retention-error harvest-retention-hint"
                    : "harvest-retention-hint"
                }
                className="max-w-sm"
              />
              {retentionError && (
                <FieldError id="harvest-retention-error">
                  {retentionError}
                </FieldError>
              )}
              <FieldDescription id="harvest-retention-hint">
                包含启动当天，留空永久保留。保存后在下次启动时清理过期终态记录；未完成和提交结果待确认的任务保留。不删除
                CMS 文章。
              </FieldDescription>
            </Field>
            <p role="status" className="text-xs text-muted-foreground">
              {status === "saving"
                ? "正在保存…"
                : status === "pending"
                  ? "待保存"
                  : status === "saved"
                    ? "已保存"
                    : status === "error"
                      ? "保存失败"
                      : "修改后自动保存"}
              {" · 停止修改 500 毫秒后自动保存，新任务使用已保存的设置。"}
            </p>
            {saveError && (
              <Alert variant="destructive">
                <AlertTitle>采集设置保存失败</AlertTitle>
                <AlertDescription>
                  <p>{saveError}。修改已保留，请重试。</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void autosave.retry().catch(() => undefined);
                    }}
                  >
                    重试
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </FieldGroup>
        )}
      </CardContent>
    </Card>
  );
}
