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
  type PromptTemplate,
} from "./contracts";
import { aiService } from "./service";
import { useAiSettings } from "./use-settings";

const blank = (): PromptTemplate => ({
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

export function TemplateSettings({ active }: { active: boolean }) {
  const { settings, loading, busy, error, run, refresh } =
    useAiSettings(active);
  const [draft, setDraft] = useState<PromptTemplate | null>(null);
  const [remove, setRemove] = useState<PromptTemplate | null>(null);
  const [target, setTarget] = useState<"systemPrompt" | "userPrompt">(
    "userPrompt",
  );
  const systemRef = useRef<HTMLTextAreaElement>(null);
  const userRef = useRef<HTMLTextAreaElement>(null);
  const disabled = busy || loading;
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          每个标题模板绑定一个模型；生成时可临时调整，不影响已保存模板。
        </p>
        <Button disabled={disabled} onClick={() => setDraft(blank())}>
          <Plus />
          新增模板
        </Button>
      </div>
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
            <CardTitle>标题模板</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!settings.templates.length && (
              <p className="text-sm text-muted-foreground">
                暂无模板，请新增。
              </p>
            )}
            {settings.templates.map((t) => (
              <Button
                key={t.id}
                variant={draft?.id === t.id ? "secondary" : "ghost"}
                disabled={disabled}
                className="h-auto w-full justify-start whitespace-normal py-3 text-left break-words"
                onClick={() => setDraft({ ...t })}
              >
                {t.isDefault && (
                  <Star className="shrink-0 size-4" aria-label="默认模板" />
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
                变量会替换为本次编辑内容。AI 返回候选标题后，仍需人工核对事实。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
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
                <div className="grid gap-4 sm:grid-cols-2">
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
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    插入变量（插入最近聚焦的提示词）
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {templateVariables.map((name) => (
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
                    title：当前标题；content：正文或摘要；count：数量；max_length：最大字数；requirements：补充要求。
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
                    <Copy />
                    复制模板
                  </Button>
                  {settings.templates.some((t) => t.id === draft.id) && (
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={disabled}
                      onClick={() => setRemove(draft)}
                    >
                      <Trash2 />
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
        <DialogContent>
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
