import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { useRef, useState } from "react";
import { Copy, Plus, Trash2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { AiChoice, AiField } from "./fields";
import {
  templateSchema,
  templateVariables,
  paginationVariables,
  defaultPaginationOptions,
  type PromptTemplate,
} from "./contracts";
import { aiService } from "./service";
import { useAiSettings } from "./use-settings";
import { isAndroid } from "@/lib/platform";

const blank = (purpose: PromptTemplate["purpose"]): PromptTemplate => ({
  purpose,
  paginationOptions:
    purpose === "pagination" ? { ...defaultPaginationOptions } : null,
  id: crypto.randomUUID(),
  name: "",
  systemPrompt: "你是一名严谨的新闻编辑。保留事实，不夸大、不编造。",
  userPrompt:
    "当前标题：{{title}}\n参考正文或摘要：{{content}}\n生成 {{count}} 个标题，每个最多 {{max_length}} 字符。\n补充要求：{{requirements}}",
  modelConfigId: null,
  candidateCount: 5,
  maxLength: 30,
  isDefault: false,
});

export function TemplateSettings({
  active,
  initialPurpose = "title",
  purposeOnly,
}: {
  active: boolean;
  initialPurpose?: PromptTemplate["purpose"];
  purposeOnly?: PromptTemplate["purpose"];
}) {
  const { settings, loading, busy, error, run, refresh } =
    useAiSettings(active);
  const [purpose, setPurpose] = useState<PromptTemplate["purpose"]>(
    purposeOnly ?? initialPurpose,
  );
  const [draft, setDraft] = useState<PromptTemplate | null>(null);
  const drafts = useRef<
    Partial<Record<PromptTemplate["purpose"], PromptTemplate | null>>
  >({});
  const [remove, setRemove] = useState<PromptTemplate | null>(null);
  const [target, setTarget] = useState<"systemPrompt" | "userPrompt">(
    "userPrompt",
  );
  const systemRef = useRef<HTMLTextAreaElement>(null);
  const userRef = useRef<HTMLTextAreaElement>(null);
  const disabled = busy || loading;
  const templates = settings.templates.filter((t) => t.purpose === purpose);
  function insert(name: string) {
    if (!draft) return;
    const input =
      target === "systemPrompt" ? systemRef.current : userRef.current;
    const value = draft[target];
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? start;
    const variable = `{{${name}}}`;
    setDraft({
      ...draft,
      [target]: value.slice(0, start) + variable + value.slice(end),
    });
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(
        start + variable.length,
        start + variable.length,
      );
    });
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          每类模板分别设置默认项；生成时可临时选择模型，不影响已保存模板。
        </p>
        <Button
          disabled={disabled}
          onClick={() => {
            const next = blank(purpose);
            if (purpose === "pagination") {
              next.systemPrompt =
                "判断相邻内容的语义绑定与自然边界。仅返回 bind_after、prefer_after 两个字符串数组。";
              next.userPrompt = "标题：{{title}}\n内容块：{{blocks}}";
            }
            setDraft(next);
          }}
        >
          <Plus data-icon="inline-start" />
          新增模板
        </Button>
      </div>
      {!purposeOnly && (
        <ToggleGroup
          type="single"
          value={purpose}
          disabled={disabled}
          onValueChange={(value) => {
            if (
              (value === "title" || value === "pagination") &&
              value !== purpose
            ) {
              drafts.current[purpose] = draft;
              setPurpose(value);
              setDraft(drafts.current[value] ?? null);
            }
          }}
          aria-label="模板用途"
        >
          <ToggleGroupItem value="title">标题优化</ToggleGroupItem>
          <ToggleGroupItem value="pagination">文章分页</ToggleGroupItem>
        </ToggleGroup>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
          <Button
            variant="link"
            disabled={disabled}
            onClick={() =>
              void run(async () => {
                await refresh();
              })
            }
          >
            重试读取
          </Button>
        </p>
      )}
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          正在读取提示词模板…
        </p>
      )}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <Card className="h-fit min-w-0 shadow-none">
          <CardHeader>
            <CardTitle>
              {purpose === "title" ? "标题模板" : "分页模板"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {!templates.length && (
              <p className="text-sm text-muted-foreground">
                暂无模板，请新增。
              </p>
            )}
            {templates.map((t) => (
              <Button
                key={t.id}
                variant={draft?.id === t.id ? "secondary" : "ghost"}
                disabled={disabled}
                className="h-auto w-full justify-start whitespace-normal py-3 text-left break-words"
                onClick={() => setDraft({ ...t })}
              >
                {t.isDefault && (
                  <Star className="shrink-0" aria-label="默认模板" />
                )}
                {t.name}
              </Button>
            ))}
          </CardContent>
        </Card>
        {draft ? (
          <Card className="min-w-0 shadow-none">
            <CardHeader>
              <CardTitle>编辑提示词模板</CardTitle>
              <CardDescription>
                {purpose === "title"
                  ? "变量会替换为本次编辑内容。候选标题仍需核对事实。"
                  : "AI 判断语义关系，本地按页长计算分页点；正文和图片不会由 AI 重写。"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await aiService.saveTemplate(templateSchema.parse(draft));
                  }, "提示词模板已保存");
                }}
              >
                <AiField id="ai-template-name" label="模板名称">
                  <Input
                    id="ai-template-name"
                    disabled={disabled}
                    value={draft.name}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                  />
                </AiField>
                <AiChoice
                  id="ai-template-model"
                  label="绑定模型"
                  value={draft.modelConfigId ?? ""}
                  disabled={disabled}
                  options={[
                    { value: "", label: "未绑定模型" },
                    ...settings.models.map((m) => ({
                      value: m.id,
                      label: `${settings.providers.find((p) => p.id === m.providerId)?.displayName ?? m.providerId} / ${m.displayName}`,
                    })),
                  ]}
                  onChange={(value) =>
                    setDraft({ ...draft, modelConfigId: value || null })
                  }
                />
                {draft.purpose === "title" ? (
                  <FieldGroup className="grid sm:grid-cols-2">
                    <AiField id="ai-template-count" label="默认候选数量">
                      <Input
                        id="ai-template-count"
                        type="number"
                        min={1}
                        max={10}
                        disabled={disabled}
                        value={draft.candidateCount || ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            candidateCount: Number(e.target.value),
                          })
                        }
                      />
                    </AiField>
                    <AiField id="ai-template-length" label="标题最大字数">
                      <Input
                        id="ai-template-length"
                        type="number"
                        min={1}
                        max={200}
                        disabled={disabled}
                        value={draft.maxLength || ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            maxLength: Number(e.target.value),
                          })
                        }
                      />
                    </AiField>
                  </FieldGroup>
                ) : (
                  <FieldGroup className="grid sm:grid-cols-3">
                    {(
                      [
                        ["minChars", "建议最少字数"],
                        ["targetChars", "目标字数"],
                        ["maxChars", "建议最多字数"],
                      ] as const
                    ).map(([key, label]) => (
                      <Field key={key}>
                        <FieldLabel htmlFor={`ai-pagination-${key}`}>
                          {label}
                        </FieldLabel>
                        <Input
                          id={`ai-pagination-${key}`}
                          type="number"
                          min={1}
                          max={10000}
                          disabled={disabled}
                          value={draft.paginationOptions?.[key] ?? ""}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              paginationOptions: {
                                ...(draft.paginationOptions ??
                                  defaultPaginationOptions),
                                [key]: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </Field>
                    ))}
                  </FieldGroup>
                )}
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">
                    插入变量（插入最近聚焦的提示词）
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(purpose === "title"
                      ? templateVariables
                      : paginationVariables
                    ).map((name) => (
                      <Button
                        key={name}
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={disabled}
                        onClick={() => insert(name)}
                      >{`{{${name}}}`}</Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {purpose === "title"
                      ? "title：当前标题；content：正文或摘要；count：数量；max_length：最大字数；requirements：补充要求。"
                      : "title：当前标题；blocks：编号内容块。页长不受提示词中的字数要求控制，请修改上方参数。"}
                  </p>
                </div>
                <AiField id="ai-template-system" label="系统指令">
                  <Textarea
                    ref={systemRef}
                    id="ai-template-system"
                    className="min-h-28"
                    disabled={disabled}
                    value={draft.systemPrompt}
                    onFocus={() => setTarget("systemPrompt")}
                    onChange={(e) =>
                      setDraft({ ...draft, systemPrompt: e.target.value })
                    }
                  />
                </AiField>
                <AiField id="ai-template-user" label="用户提示词">
                  <Textarea
                    ref={userRef}
                    id="ai-template-user"
                    className="min-h-44"
                    disabled={disabled}
                    value={draft.userPrompt}
                    onFocus={() => setTarget("userPrompt")}
                    onChange={(e) =>
                      setDraft({ ...draft, userPrompt: e.target.value })
                    }
                  />
                </AiField>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={draft.isDefault}
                    onChange={(e) =>
                      setDraft({ ...draft, isDefault: e.target.checked })
                    }
                  />
                  设为默认模板
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={disabled}>
                    {busy ? "正在保存…" : "保存模板"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        id: crypto.randomUUID(),
                        name: `${draft.name}（副本）`,
                        isDefault: false,
                      })
                    }
                  >
                    <Copy data-icon="inline-start" />
                    复制模板
                  </Button>
                  {settings.templates.some((t) => t.id === draft.id) && (
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={disabled}
                      onClick={() => setRemove(draft)}
                    >
                      <Trash2 data-icon="inline-start" />
                      删除模板
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-none">
            <CardContent className="py-10 text-sm text-muted-foreground">
              选择模板进行编辑，或新增一个模板。
            </CardContent>
          </Card>
        )}
      </div>
      <Dialog
        open={!!remove}
        onOpenChange={(open) => {
          if (!open && !busy) setRemove(null);
        }}
      >
        <DialogContent
          data-import-dialog={isAndroid() ? "template-delete" : undefined}
        >
          <DialogTitle>删除提示词模板？</DialogTitle>
          <DialogDescription>
            将删除“{remove?.name}”。
            {remove?.isDefault && "删除后不自动选择其他默认模板。"}
          </DialogDescription>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRemove(null)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (remove)
                  void run(async () => {
                    await aiService.remove("template", remove.id);
                    setRemove(null);
                    setDraft(null);
                  }, "模板已删除");
              }}
            >
              确认删除
            </Button>
          </DialogFooter>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
