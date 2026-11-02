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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
import { emptySettings, type AiSettings } from "@/features/ai/contracts";
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
    "aiAutoPaginate",
    "AI 自动分页",
    "复用分页助手的默认模板、绑定模型和页长规则；失败保留原排版并继续导入。",
  ],
] as const;

export function HarvestSettings({
  active,
  onConfigurePagination,
}: {
  active: boolean;
  onConfigurePagination?: () => void;
}) {
  const {
    form,
    days,
    retentionError,
    status,
    error: saveError,
    modeSaving,
  } = useSyncExternalStore(autosave.subscribe, autosave.getSnapshot);
  const [aiSettings, setAiSettings] = useState<AiSettings>(emptySettings);
  const models = aiSettings.models;
  const paginationTemplate = aiSettings.templates.find(
    (t) => t.purpose === "pagination" && t.isDefault,
  );
  const paginationModel = models.find(
    (m) => m.id === paginationTemplate?.modelConfigId,
  );
  const paginationOptions = paginationTemplate?.paginationOptions;
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
        if (ai.status === "fulfilled") setAiSettings(ai.value);
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
            {/* 获取配置沿用自动保存，隐藏 CDP 字段时保留用户已填写的地址。 */}
            <FieldSet>
              <FieldLegend variant="label">素材获取方式</FieldLegend>
              <FieldGroup>
                <Field>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    aria-label="素材获取方式"
                    value={form.sourceMode}
                    disabled={loading}
                    onValueChange={(value) => {
                      if (value === "webview" || value === "cdp")
                        autosave.update({ sourceMode: value });
                    }}
                  >
                    <ToggleGroupItem value="webview">
                      内置 WebView
                    </ToggleGroupItem>
                    <ToggleGroupItem value="cdp">浏览器 CDP</ToggleGroupItem>
                  </ToggleGroup>
                  <FieldDescription>
                    新任务使用入队时的获取方式；旧任务重试使用最新获取配置，AI
                    规则和开发者模式保留原快照。
                  </FieldDescription>
                </Field>
                {form.sourceMode === "cdp" && (
                  <>
                    <Field>
                      <FieldLabel>连接的浏览器</FieldLabel>
                      <ToggleGroup
                        type="single"
                        variant="outline"
                        aria-label="连接的浏览器"
                        value={form.cdpBrowser}
                        disabled={loading}
                        onValueChange={(value) => {
                          if (value === "chrome" || value === "edge")
                            autosave.update({ cdpBrowser: value });
                        }}
                      >
                        <ToggleGroupItem value="chrome">Chrome</ToggleGroupItem>
                        <ToggleGroupItem value="edge">
                          Microsoft Edge
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="harvest-cdp-address">
                        数据目录或 CDP 地址
                      </FieldLabel>
                      <Input
                        id="harvest-cdp-address"
                        value={form.cdpAddress ?? ""}
                        maxLength={4096}
                        disabled={loading}
                        placeholder="留空自动发现已运行的浏览器"
                        onChange={(event) =>
                          autosave.update({
                            cdpAddress: event.target.value || null,
                          })
                        }
                      />
                      <FieldDescription>
                        支持浏览器数据目录、DevToolsActivePort 文件、HTTP/HTTPS
                        调试入口及浏览器级 WS/WSS
                        地址。优先读取已有文章标签页并复用登录状态。
                      </FieldDescription>
                    </Field>
                    <FieldContent>
                      <FieldDescription>
                        在 {form.cdpBrowser === "chrome" ? "Chrome" : "Edge"}{" "}
                        中打开{" "}
                        <code>
                          {form.cdpBrowser}://inspect/#remote-debugging
                        </code>
                        ，勾选“允许此浏览器实例进行远程调试”。保持浏览器打开，开始采集时在浏览器连接提示中点击“允许”。
                      </FieldDescription>
                      <FieldDescription>
                        {form.cdpBrowser === "chrome"
                          ? "Chrome 需为 144 或更新版本。"
                          : ""}
                        找不到选项时，请在{" "}
                        <code>{form.cdpBrowser}://settings/help</code>{" "}
                        更新浏览器。自动发现失败可填写自定义数据目录或调试地址后重试。
                      </FieldDescription>
                    </FieldContent>
                  </>
                )}
              </FieldGroup>
            </FieldSet>
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
            <FieldSet>
              <FieldLegend variant="label">共用分页助手配置</FieldLegend>
              <FieldContent>
                <FieldDescription>
                  {paginationTemplate && paginationModel && paginationOptions
                    ? `${paginationTemplate.name} · ${paginationModel.displayName} · 每页最少 ${paginationOptions.minChars}、目标 ${paginationOptions.targetChars}、最多 ${paginationOptions.maxChars} 字。`
                    : "默认文章分页模板、绑定模型或页长尚未配置完整；开启后仍可导入，分页步骤会提示回退。"}
                </FieldDescription>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={onConfigurePagination}
                  disabled={!onConfigurePagination}
                >
                  配置默认分页模板
                </Button>
              </FieldContent>
            </FieldSet>
            <Field>
              <FieldLabel htmlFor="harvest-model">元数据处理模型</FieldLabel>
              <Select<string>
                value={form.modelConfigId ?? ""}
                items={[
                  { value: "", label: "未配置（元数据保留后台结果）" },
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
                      未配置（元数据保留后台结果）
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
                用于分类、标签和摘要；AI
                自动分页使用默认分页模板绑定的模型。所有 AI 项关闭时不发送 AI
                请求。
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
