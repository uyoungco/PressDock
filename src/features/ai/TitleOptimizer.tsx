import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { AiChoice, AiField } from "./fields";
import {
  emptySettings,
  countSchema,
  lengthSchema,
  type AiSettings,
  type PromptTemplate,
  type TitleSuggestionResult,
} from "./contracts";
import { aiService } from "./service";
import { aiErrorMessage } from "./use-settings";

type Options = {
  templateId: string;
  modelConfigId: string;
  candidateCount: number;
  maxLength: number;
  requirements: string;
};
const fromTemplate = (
  template: PromptTemplate,
  requirements = "",
): Options => ({
  templateId: template.id,
  modelConfigId: template.modelConfigId ?? "",
  candidateCount: template.candidateCount,
  maxLength: template.maxLength,
  requirements,
});

export function TitleOptimizer({
  title,
  content,
  disabled,
  onAdopt,
  titleInputId,
}: {
  title: string;
  content: string;
  disabled?: boolean;
  onAdopt: (title: string) => void;
  titleInputId: string;
}) {
  const [source, setSource] = useState<{
    title: string;
    content: string;
  } | null>(null);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => setSource({ title, content })}
      >
        <Sparkles className="size-4" />
        AI 优化
      </Button>
      {source && (
        <TitleDialog
          source={source}
          sourceChanged={
            title !== source.title || content !== source.content || !!disabled
          }
          onClose={() => {
            setSource(null);
            requestAnimationFrame(() =>
              document.getElementById(titleInputId)?.focus(),
            );
          }}
          onAdopt={onAdopt}
        />
      )}
    </>
  );
}

function TitleDialog({
  source,
  sourceChanged,
  onClose,
  onAdopt,
}: {
  source: { title: string; content: string };
  sourceChanged: boolean;
  onClose: () => void;
  onAdopt: (value: string) => void;
}) {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<AiSettings>(emptySettings);
  const [options, setOptions] = useState<Options>({
    templateId: "",
    modelConfigId: "",
    candidateCount: 5,
    maxLength: 30,
    requirements: "",
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TitleSuggestionResult | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const initial = useRef(source);
  const sourceValid = useRef(true);
  sourceValid.current = !sourceChanged;
  async function generate(next: Options) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const version = ++sequence.current;
    setError(null);
    setResult(null);
    try {
      countSchema.parse(next.candidateCount);
      lengthSchema.parse(next.maxLength);
      if (!next.templateId || !next.modelConfigId)
        throw new Error("请选择模板及模型，或先前往设置完成配置");
      if (!sourceValid.current)
        throw new Error("编辑内容已变化，请关闭弹窗后重新生成");
      setBusy(true);
      const response = await aiService.suggest(
        {
          ...next,
          title: initial.current.title,
          content: initial.current.content,
        },
        current.signal,
      );
      if (
        mounted.current &&
        version === sequence.current &&
        !current.signal.aborted &&
        sourceValid.current
      )
        setResult(response);
    } catch (reason) {
      if (
        mounted.current &&
        version === sequence.current &&
        !current.signal.aborted
      )
        setError(aiErrorMessage(reason));
    } finally {
      if (mounted.current && version === sequence.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    let valid = true;
    aiService
      .load()
      .then((data) => {
        if (!valid) return;
        setSettings(data);
        setLoading(false);
        const template = data.templates.find((t) => t.isDefault);
        if (template) {
          const next = fromTemplate(template);
          setOptions(next);
          if (data.models.some((m) => m.id === next.modelConfigId))
            void generate(next);
        }
      })
      .catch((reason) => {
        if (valid) {
          setError(aiErrorMessage(reason));
          setLoading(false);
        }
      });
    return () => {
      valid = false;
      mounted.current = false;
      sequence.current += 1;
      controller.current?.abort();
    };
    // source 是本次打开的固定快照；自动生成仅发生在首次配置读取成功后。
  }, []);
  useEffect(() => {
    if (sourceChanged) {
      controller.current?.abort();
      sequence.current += 1;
      setBusy(false);
      setResult(null);
    }
  }, [sourceChanged]);
  function change(next: Options) {
    setOptions(next);
    setResult(null);
    setError(null);
  }
  function close() {
    sequence.current += 1;
    controller.current?.abort();
    onClose();
  }
  const configured = !!settings.models.length && !!settings.templates.length;
  const selectedTemplate = settings.templates.find(
    (template) => template.id === options.templateId,
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-2xl"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>AI 优化标题</DialogTitle>
          <DialogDescription>
            根据当前标题及{source.content.trim() ? "正文或摘要" : "已有标题"}
            生成候选，采用后仍需手动保存。
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-1">
          <div className="space-y-1 rounded-lg bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground">当前标题</p>
            <p className="text-sm break-words">
              {source.title || "（未填写标题）"}
            </p>
            <p className="text-xs text-muted-foreground">
              参考正文/摘要：{[...source.content].length} 字符，发送至所选 AI
              服务。候选标题需人工核对。
            </p>
          </div>
          {loading ? (
            <p role="status" className="flex items-center gap-2 text-sm">
              <LoaderCircle className="size-4 animate-spin" />
              正在读取配置…
            </p>
          ) : (
            <>
              {!configured && (
                <div className="space-y-2 rounded-lg border p-3">
                  <p className="text-sm">
                    请先配置 AI 模型，并为提示词模板绑定模型。
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      close();
                      navigate("/settings?tab=ai-models");
                    }}
                  >
                    前往 AI 模型设置
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      close();
                      navigate("/settings?tab=ai-templates");
                    }}
                  >
                    前往提示词模板
                  </Button>
                </div>
              )}
              {configured && (
                <>
                  <AiChoice
                    id="ai-title-template"
                    label="提示词模板"
                    disabled={busy}
                    value={options.templateId}
                    options={[
                      { value: "", label: "请选择模板（未配置默认模板）" },
                      ...settings.templates.map((t) => ({
                        value: t.id,
                        label: t.name + (t.isDefault ? "（默认）" : ""),
                      })),
                    ]}
                    onChange={(id) => {
                      const template = settings.templates.find(
                        (t) => t.id === id,
                      );
                      if (template)
                        change(fromTemplate(template, options.requirements));
                    }}
                  />
                  <AiChoice
                    id="ai-title-model"
                    label="本次使用模型"
                    disabled={busy || !selectedTemplate?.modelConfigId}
                    value={options.modelConfigId}
                    options={[
                      { value: "", label: "请选择模型" },
                      ...settings.models.map((m) => ({
                        value: m.id,
                        label: `${settings.providers.find((p) => p.id === m.providerId)?.displayName ?? m.providerId} / ${m.displayName}`,
                      })),
                    ]}
                    onChange={(id) => change({ ...options, modelConfigId: id })}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <AiField id="ai-title-count" label="候选数量">
                      <Input
                        id="ai-title-count"
                        type="number"
                        min={1}
                        max={10}
                        disabled={busy}
                        value={options.candidateCount || ""}
                        onChange={(e) =>
                          change({
                            ...options,
                            candidateCount: Number(e.target.value),
                          })
                        }
                      />
                    </AiField>
                    <AiField id="ai-title-length" label="最大字数">
                      <Input
                        id="ai-title-length"
                        type="number"
                        min={1}
                        max={200}
                        disabled={busy}
                        value={options.maxLength || ""}
                        onChange={(e) =>
                          change({
                            ...options,
                            maxLength: Number(e.target.value),
                          })
                        }
                      />
                    </AiField>
                  </div>
                  <AiField
                    id="ai-title-requirements"
                    label="补充要求（仅本次）"
                  >
                    <Textarea
                      id="ai-title-requirements"
                      disabled={busy}
                      value={options.requirements}
                      placeholder="例如：突出数据，不要夸张"
                      onChange={(e) =>
                        change({ ...options, requirements: e.target.value })
                      }
                    />
                  </AiField>
                  {selectedTemplate && !selectedTemplate.modelConfigId && (
                    <div className="space-y-2 rounded-lg border p-3">
                      <p className="text-sm text-muted-foreground">
                        当前模板尚未绑定模型，请先完成模板配置。
                      </p>
                      <Button
                        variant="outline"
                        onClick={() => {
                          close();
                          navigate("/settings?tab=ai-templates");
                        }}
                      >
                        前往提示词模板
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {sourceChanged && (
            <p role="alert" className="text-sm text-destructive">
              编辑内容已变化，请关闭弹窗后重新生成。
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {busy && (
            <p role="status" className="flex items-center gap-2 text-sm">
              <LoaderCircle className="size-4 animate-spin" />
              正在生成候选标题…
            </p>
          )}
          {result && (
            <div className="space-y-3" aria-label="候选标题列表">
              <p role="status" className="text-sm text-muted-foreground">
                获得 {result.candidates.length} / {result.requestedCount}{" "}
                个有效候选
                {result.candidates.length < result.requestedCount &&
                  "（已去除重复、空白或超长结果）"}
              </p>
              {result.candidates.map((candidate, index) => (
                <div
                  key={candidate}
                  className="flex items-start gap-3 rounded-lg border p-3"
                >
                  <span className="pt-1 text-xs text-muted-foreground">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-6 break-words">{candidate}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[...candidate].length} 字符
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={sourceChanged}
                    onClick={() => {
                      if (!sourceValid.current) return;
                      onAdopt(candidate);
                      close();
                    }}
                  >
                    采用<span className="sr-only">候选 {index + 1}</span>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={close}>
            {busy ? "取消生成并关闭" : "关闭"}
          </Button>
          {configured && (
            <Button
              disabled={
                loading ||
                busy ||
                sourceChanged ||
                !options.templateId ||
                !selectedTemplate?.modelConfigId ||
                !options.modelConfigId
              }
              onClick={() => void generate(options)}
            >
              <Sparkles />
              {busy ? "正在生成…" : "重新生成"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
