import { useState } from "react";
import { Plus, Trash2, FlaskConical, Download, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { aiService } from "./service";
import {
  defaultCompatibility,
  modelSchema,
  saveProviderSchema,
  type AiModelConfig,
  type SaveProviderRequest,
} from "./contracts";
import { AiChoice, AiField } from "./fields";
import { useAiSettings } from "./use-settings";
import { MobileEditor } from "@/features/settings/MobileEditor";
import {
  useMobileSettings,
  useSettingsDraft,
} from "@/features/settings/mobile-state";
import { isAndroid } from "@/lib/platform";

const blankProvider = (): SaveProviderRequest => ({
  id: "",
  displayName: "",
  baseUrl: "",
  protocol: "chatCompletions",
  apiKey: "",
  compatibility: { ...defaultCompatibility },
});
const numberValue = (value: string) => (value === "" ? null : Number(value));

export function ModelSettings({ active }: { active: boolean }) {
  const { settings, loading, busy, error, run, refresh } =
    useAiSettings(active);
  const mobile = useMobileSettings();
  const [localProvider, setLocalProvider] =
    useState<SaveProviderRequest | null>(null);
  const [localExisting, setExisting] = useState(false);
  const [localModel, setLocalModel] = useState<AiModelConfig | null>(null);
  const [providerDrafts, setProviderDrafts] = useState<
    Record<string, SaveProviderRequest>
  >({});
  const [modelDrafts, setModelDrafts] = useState<Record<string, AiModelConfig>>(
    {},
  );
  const editor = active ? mobile?.editor : null;
  const providerKey =
    editor?.kind === "provider" ? editor.id : mobile?.providerId;
  const storedProvider = settings.providers.find((p) => p.id === providerKey);
  const provider = mobile
    ? providerKey
      ? (providerDrafts[providerKey] ??
        (storedProvider ? { ...storedProvider, apiKey: "" } : null))
      : null
    : localProvider;
  const model = mobile
    ? editor?.kind === "model"
      ? (modelDrafts[editor.id] ??
        settings.models.find((m) => m.id === editor.id) ??
        null)
      : null
    : localModel;
  const existing = mobile ? providerKey !== "new-provider" : localExisting;
  // 手机按条目缓存草稿，避免选择另一提供商或返回列表时覆盖输入。
  function setProvider(next: SaveProviderRequest | null) {
    if (!mobile) {
      setLocalProvider(next);
      return;
    }
    if (next) {
      const key =
        editor?.kind === "provider" ? editor.id : next.id || "new-provider";
      setProviderDrafts((previous) => ({ ...previous, [key]: next }));
    }
  }
  function setModel(next: AiModelConfig | null) {
    if (!mobile) {
      setLocalModel(next);
      return;
    }
    if (next) setModelDrafts((previous) => ({ ...previous, [next.id]: next }));
  }
  function editModel(next: AiModelConfig) {
    if (!mobile || !settings.models.some((saved) => saved.id === next.id))
      setModel(modelDrafts[next.id] ?? next);
    mobile?.openEditor({ kind: "model", id: next.id });
  }
  useSettingsDraft(
    "models",
    Object.values(providerDrafts).some((value) => {
      const saved = settings.providers.find((p) => p.id === value.id);
      return (
        !!value.apiKey ||
        !saved ||
        (
          ["id", "displayName", "baseUrl", "protocol", "compatibility"] as const
        ).some(
          (key) => JSON.stringify(value[key]) !== JSON.stringify(saved[key]),
        )
      );
    }) ||
      Object.values(modelDrafts).some(
        (value) =>
          JSON.stringify(value) !==
          JSON.stringify(
            settings.models.find((saved) => saved.id === value.id),
          ),
      ),
    busy,
  );
  const [catalog, setCatalog] = useState<string[]>([]);
  const [remove, setRemove] = useState<{
    kind: "provider" | "model";
    id: string;
    name: string;
  } | null>(null);
  const savedProvider = settings.providers.find((p) => p.id === provider?.id);
  // 新建但未保存的模型也留在列表，返回后可继续编辑同一份草稿。
  const models = [
    ...settings.models,
    ...(mobile
      ? Object.values(modelDrafts).filter(
          (draft) => !settings.models.some((saved) => saved.id === draft.id),
        )
      : []),
  ].filter((m) => m.providerId === savedProvider?.id);
  const disabled = busy || loading;
  const choose = (id: string) => {
    const next = settings.providers.find((p) => p.id === id);
    if (!next) return;
    if (!mobile)
      setProvider(
        providerDrafts[id] ?? {
          id: next.id,
          displayName: next.displayName,
          baseUrl: next.baseUrl,
          protocol: next.protocol,
          apiKey: "",
          compatibility: { ...next.compatibility },
        },
      );
    setExisting(true);
    setModel(null);
    setCatalog([]);
    mobile?.selectProvider(id);
  };
  const providerForm = provider && (
    <form
      id="settings-provider-form"
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const request = saveProviderSchema.parse({
            ...provider,
            apiKey: provider.apiKey || null,
            createOnly: !existing,
          });
          await aiService.saveProvider(request);
          if (!mobile) setProvider({ ...request, apiKey: "" });
          setExisting(true);
        }, "提供商已保存").then((saved) => {
          if (saved && mobile) {
            setProviderDrafts((previous) => {
              const next = { ...previous };
              delete next[providerKey!];
              return next;
            });
            mobile.closeEditor();
          }
        });
      }}
    >
      <AiField
        id="ai-provider-id"
        label="提供商标识"
        hint="以小写字母开头，保存后不可修改。"
      >
        <Input
          id="ai-provider-id"
          value={provider.id}
          disabled={disabled || existing}
          placeholder="acme-gateway"
          onChange={(e) => setProvider({ ...provider, id: e.target.value })}
        />
      </AiField>
      <AiField id="ai-provider-name" label="显示名称">
        <Input
          id="ai-provider-name"
          value={provider.displayName}
          disabled={disabled}
          onChange={(e) =>
            setProvider({
              ...provider,
              displayName: e.target.value,
            })
          }
        />
      </AiField>
      <AiField id="ai-provider-url" label="API 地址">
        <Input
          id="ai-provider-url"
          value={provider.baseUrl}
          disabled={disabled}
          placeholder="https://gateway.example/v1"
          onChange={(e) =>
            setProvider({ ...provider, baseUrl: e.target.value })
          }
        />
      </AiField>
      <AiChoice
        id="ai-provider-protocol"
        label="API 协议"
        value={provider.protocol}
        disabled={disabled}
        options={[
          {
            value: "chatCompletions",
            label: "OpenAI Chat Completions",
          },
          { value: "responses", label: "OpenAI Responses" },
        ]}
        onChange={(value) =>
          setProvider({
            ...provider,
            protocol: value as SaveProviderRequest["protocol"],
          })
        }
      />
      <AiField
        id="ai-provider-key"
        label="API 密钥"
        hint={
          savedProvider?.hasApiKey
            ? "已保存到系统凭据库；留空保留原密钥，填写可替换。"
            : "密钥保存到系统凭据库；本地免密服务可留空。"
        }
      >
        <Input
          id="ai-provider-key"
          type="password"
          autoComplete="new-password"
          value={provider.apiKey ?? ""}
          disabled={disabled}
          placeholder={
            savedProvider?.hasApiKey ? "已配置，留空不修改" : "输入 API 密钥"
          }
          onChange={(e) => setProvider({ ...provider, apiKey: e.target.value })}
        />
      </AiField>
      <details className="space-y-4 rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          网关兼容设置
        </summary>
        {provider.protocol === "chatCompletions" && (
          <>
            <AiChoice
              id="ai-token-field"
              label="输出 token 参数"
              value={provider.compatibility.maxTokensField}
              disabled={disabled}
              options={[
                {
                  value: "max_completion_tokens",
                  label: "max_completion_tokens（OpenAI）",
                },
                {
                  value: "max_tokens",
                  label: "max_tokens（部分兼容网关）",
                },
              ]}
              onChange={(value) =>
                setProvider({
                  ...provider,
                  compatibility: {
                    ...provider.compatibility,
                    maxTokensField: value as
                      "max_completion_tokens" | "max_tokens",
                  },
                })
              }
            />
            <AiChoice
              id="ai-system-role"
              label="系统指令角色"
              value={provider.compatibility.systemRole}
              disabled={disabled}
              options={[
                { value: "system", label: "system" },
                { value: "developer", label: "developer" },
              ]}
              onChange={(value) =>
                setProvider({
                  ...provider,
                  compatibility: {
                    ...provider.compatibility,
                    systemRole: value as "system" | "developer",
                  },
                })
              }
            />
          </>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={provider.compatibility.sendStore}
            disabled={disabled}
            onChange={(e) =>
              setProvider({
                ...provider,
                compatibility: {
                  ...provider.compatibility,
                  sendStore: e.target.checked,
                },
              })
            }
          />
          发送 store: false
        </label>
        <p className="text-xs text-muted-foreground">
          仅在服务商不接受该字段时关闭；关闭后由服务商决定响应保存策略。
        </p>
      </details>
      <div hidden={!!mobile} className="flex flex-wrap justify-between gap-2">
        <Button type="submit" disabled={disabled}>
          <KeyRound />
          {busy ? "正在处理…" : "保存提供商"}
        </Button>
        {existing && (
          <Button
            type="button"
            variant="destructive"
            disabled={disabled}
            onClick={() =>
              setRemove({
                kind: "provider",
                id: provider.id,
                name: provider.displayName,
              })
            }
          >
            <Trash2 />
            删除提供商
          </Button>
        )}
      </div>
    </form>
  );
  const modelForm = model && (
    <form
      id="settings-model-form"
      className="space-y-4 rounded-lg border bg-muted/20 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await aiService.saveModel(modelSchema.parse(model));
          setModel(null);
        }, "模型配置已保存").then((saved) => {
          if (saved && mobile) {
            setModelDrafts((previous) => {
              const next = { ...previous };
              delete next[model.id];
              return next;
            });
            mobile.closeEditor();
          }
        });
      }}
    >
      <AiField id="ai-model-id" label="模型 ID">
        <Input
          id="ai-model-id"
          value={model.modelId}
          disabled={disabled}
          onChange={(e) => setModel({ ...model, modelId: e.target.value })}
        />
      </AiField>
      <AiField id="ai-model-name" label="模型显示名称">
        <Input
          id="ai-model-name"
          value={model.displayName}
          disabled={disabled}
          onChange={(e) => setModel({ ...model, displayName: e.target.value })}
        />
      </AiField>
      <div className="grid gap-4 sm:grid-cols-2">
        <AiField id="ai-model-context" label="上下文窗口（token）">
          <Input
            id="ai-model-context"
            type="number"
            min={1}
            value={model.contextWindow ?? ""}
            placeholder="可选"
            disabled={disabled}
            onChange={(e) =>
              setModel({
                ...model,
                contextWindow: numberValue(e.target.value),
              })
            }
          />
        </AiField>
        <AiField id="ai-model-output" label="最大输出 token 数">
          <Input
            id="ai-model-output"
            type="number"
            min={1}
            value={model.maxOutputTokens ?? ""}
            placeholder="留空使用服务端默认"
            disabled={disabled}
            onChange={(e) =>
              setModel({
                ...model,
                maxOutputTokens: numberValue(e.target.value),
              })
            }
          />
        </AiField>
      </div>
      <AiChoice
        id="ai-model-reasoning"
        label="推理强度"
        value={model.reasoningEffort ?? ""}
        disabled={disabled}
        options={[
          { value: "", label: "不设置（使用模型默认）" },
          { value: "low", label: "低" },
          { value: "medium", label: "中" },
          { value: "high", label: "高" },
        ]}
        onChange={(value) =>
          setModel({
            ...model,
            reasoningEffort: value
              ? (value as "low" | "medium" | "high")
              : null,
          })
        }
      />
      <p className="text-xs text-muted-foreground">
        仅支持文本。可选参数只在填写后发送，模型须支持所选参数。
      </p>
      <div hidden={!!mobile} className="flex gap-2">
        <Button type="submit" disabled={disabled}>
          保存模型
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => setModel(null)}
        >
          取消编辑
        </Button>
      </div>
    </form>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          本机工作区共用模型配置，供标题优化及后续模块复用。
        </p>
        <Button
          disabled={disabled}
          onClick={() => {
            // 再次新增会继续尚未保存的提供商，密钥仅保留于本组件内存。
            setProvider(
              mobile
                ? (providerDrafts["new-provider"] ?? blankProvider())
                : blankProvider(),
            );
            setExisting(false);
            setModel(null);
            setCatalog([]);
            mobile?.openEditor({ kind: "provider", id: "new-provider" });
          }}
        >
          <Plus />
          {mobile && providerDrafts["new-provider"]
            ? "继续新增提供商"
            : "新增提供商"}
        </Button>
      </div>
      {error && !editor && (
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
          正在读取 AI 配置…
        </p>
      )}
      <div
        className={`grid min-w-0 gap-4 ${mobile ? "" : "lg:grid-cols-[220px_minmax(0,1fr)]"}`}
      >
        <Card
          className="h-fit min-w-0 shadow-none"
          hidden={!!mobile?.providerId}
        >
          <CardHeader>
            <CardTitle>提供商</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!settings.providers.length && (
              <p className="text-sm text-muted-foreground">
                尚未配置提供商，请先新增。
              </p>
            )}
            {settings.providers.map((p) => (
              <Button
                key={p.id}
                variant={provider?.id === p.id ? "secondary" : "ghost"}
                className="h-auto w-full justify-start whitespace-normal py-3 text-left break-words"
                disabled={disabled}
                onClick={() => choose(p.id)}
              >
                {p.displayName}
                <span className="ml-auto text-xs text-muted-foreground">
                  {settings.models.filter((m) => m.providerId === p.id).length}
                </span>
              </Button>
            ))}
          </CardContent>
        </Card>
        {provider ? (
          <div className="min-w-0 space-y-4">
            {!mobile && (
              <Card className="min-w-0 shadow-none">
                <CardHeader>
                  <CardTitle>
                    {existing ? "编辑提供商" : "新增提供商"}
                  </CardTitle>
                  <CardDescription>
                    API 地址填写基础路径，如
                    https://gateway.example/v1。保存后可添加模型。
                  </CardDescription>
                </CardHeader>
                <CardContent>{providerForm}</CardContent>
              </Card>
            )}
            {mobile && savedProvider && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">{savedProvider.displayName}</h2>
                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={() =>
                    mobile.openEditor({
                      kind: "provider",
                      id: savedProvider.id,
                    })
                  }
                >
                  编辑提供商
                </Button>
                <Button
                  variant="destructive"
                  disabled={disabled}
                  onClick={() =>
                    setRemove({
                      kind: "provider",
                      id: savedProvider.id,
                      name: savedProvider.displayName,
                    })
                  }
                >
                  删除提供商
                </Button>
              </div>
            )}
            {savedProvider && (
              <Card className="min-w-0 shadow-none">
                <CardHeader>
                  <CardTitle>模型目录</CardTitle>
                  <CardDescription>
                    拉取列表只获得模型
                    ID，上下文、输出上限和推理强度请按服务商说明填写。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={disabled}
                      onClick={() =>
                        void run(async (signal) => {
                          setCatalog(
                            await aiService.listModels(
                              savedProvider.id,
                              signal,
                            ),
                          );
                        }, "模型列表已读取")
                      }
                    >
                      <Download />
                      获取可用模型
                    </Button>
                    <Button
                      variant="outline"
                      disabled={disabled}
                      onClick={() =>
                        editModel({
                          id: crypto.randomUUID(),
                          providerId: savedProvider.id,
                          modelId: "",
                          displayName: "",
                          contextWindow: null,
                          maxOutputTokens: null,
                          reasoningEffort: null,
                        })
                      }
                    >
                      <Plus />
                      添加模型
                    </Button>
                  </div>
                  {!!catalog.length && (
                    <AiChoice
                      id="ai-catalog"
                      label="选择可用模型添加"
                      value=""
                      disabled={disabled}
                      options={[
                        { value: "", label: "请选择模型" },
                        ...catalog.map((id) => ({ value: id, label: id })),
                      ]}
                      onChange={(id) => {
                        if (id)
                          editModel({
                            id: crypto.randomUUID(),
                            providerId: savedProvider.id,
                            modelId: id,
                            displayName: id,
                            contextWindow: null,
                            maxOutputTokens: null,
                            reasoningEffort: null,
                          });
                      }}
                    />
                  )}
                  {!models.length && (
                    <p className="text-sm text-muted-foreground">
                      尚未添加模型，可手动填写或从列表选择。
                    </p>
                  )}
                  {models.map((m) => (
                    <div
                      key={m.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
                    >
                      <div className="min-w-0 flex-1 break-all">
                        <p className="text-sm font-medium">
                          {m.displayName || "未命名模型"}
                          {mobile &&
                            !settings.models.some(
                              (saved) => saved.id === m.id,
                            ) &&
                            "（未保存）"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {m.modelId}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={disabled}
                        onClick={() => editModel({ ...m })}
                      >
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          disabled ||
                          (!!mobile &&
                            !settings.models.some((saved) => saved.id === m.id))
                        }
                        onClick={() =>
                          void run(async (signal) => {
                            await aiService.testModel(m.id, signal);
                          }, "模型已返回可用文本")
                        }
                      >
                        <FlaskConical />
                        测试
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`删除模型 ${m.displayName}`}
                        disabled={
                          disabled ||
                          (!!mobile &&
                            !settings.models.some((saved) => saved.id === m.id))
                        }
                        onClick={() =>
                          setRemove({
                            kind: "model",
                            id: m.id,
                            name: m.displayName,
                          })
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  {!mobile && modelForm}
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <Card hidden={!!mobile} className="shadow-none">
            <CardContent className="py-10 text-sm text-muted-foreground">
              选择提供商查看配置，或新增一个提供商。
            </CardContent>
          </Card>
        )}
      </div>
      {mobile && editor?.kind === "provider" && provider && (
        <MobileEditor
          title={existing ? "编辑提供商" : "新增提供商"}
          formId="settings-provider-form"
          busy={disabled}
          error={error}
        >
          {providerForm}
        </MobileEditor>
      )}
      {mobile && editor?.kind === "model" && model && (
        <MobileEditor
          title="编辑模型"
          formId="settings-model-form"
          busy={disabled}
          error={error}
        >
          {modelForm}
        </MobileEditor>
      )}
      <Dialog
        open={!!remove}
        onOpenChange={(open) => {
          if (!open && !busy) setRemove(null);
        }}
      >
        <DialogContent
          data-import-dialog={isAndroid() ? "model-delete" : undefined}
        >
          <DialogTitle>
            删除{remove?.kind === "provider" ? "提供商" : "模型"}？
          </DialogTitle>
          <DialogDescription>
            将删除“{remove?.name}”
            {remove?.kind === "provider"
              ? "及其全部模型和保存的密钥"
              : "的配置"}
            。被模板引用时须先解除引用。
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
                    await aiService.remove(remove.kind, remove.id);
                    if (remove.kind === "provider") {
                      setProvider(null);
                      setModel(null);
                    } else if (model?.id === remove.id) setModel(null);
                    if (mobile) {
                      setProviderDrafts((previous) =>
                        Object.fromEntries(
                          Object.entries(previous).filter(
                            ([, value]) =>
                              remove.kind !== "provider" ||
                              value.id !== remove.id,
                          ),
                        ),
                      );
                      setModelDrafts((previous) =>
                        Object.fromEntries(
                          Object.entries(previous).filter(([, value]) =>
                            remove.kind === "provider"
                              ? value.providerId !== remove.id
                              : value.id !== remove.id,
                          ),
                        ),
                      );
                      if (remove.kind === "provider")
                        mobile.selectProvider(null);
                    }
                    setRemove(null);
                  }, "配置已删除");
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
