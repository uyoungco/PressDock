import {
  defaultCompatibility,
  type AiSettings,
  type TitleSuggestionResult,
} from "@/features/ai/contracts";

export const aiSettings = (): AiSettings => ({
  providers: [
    {
      id: "demo-gateway",
      displayName: "演示网关",
      baseUrl: "https://gateway.example/v1",
      protocol: "chatCompletions",
      hasApiKey: true,
      compatibility: { ...defaultCompatibility },
    },
  ],
  models: [
    {
      id: "model-1",
      providerId: "demo-gateway",
      modelId: "demo-model",
      displayName: "演示文本模型",
      contextWindow: null,
      maxOutputTokens: null,
      reasoningEffort: null,
    },
    {
      id: "model-2",
      providerId: "demo-gateway",
      modelId: "demo-second",
      displayName: "演示备用模型",
      contextWindow: 32000,
      maxOutputTokens: 2048,
      reasoningEffort: "low",
    },
  ],
  templates: [
    {
      id: "template-1",
      name: "新闻标题优化",
      systemPrompt: "保留事实",
      userPrompt:
        "{{title}}\n{{content}}\n{{count}}\n{{max_length}}\n{{requirements}}",
      modelConfigId: "model-1",
      candidateCount: 5,
      maxLength: 30,
      isDefault: true,
    },
    {
      id: "template-2",
      name: "简洁标题",
      systemPrompt: "简洁",
      userPrompt: "{{title}}",
      modelConfigId: "model-2",
      candidateCount: 3,
      maxLength: 20,
      isDefault: false,
    },
  ],
});
export const aiResult = (
  overrides: Partial<TitleSuggestionResult> = {},
): TitleSuggestionResult => ({
  jobId: crypto.randomUUID(),
  templateId: "template-1",
  modelConfigId: "model-1",
  candidates: ["演示候选标题一", "演示候选标题二"],
  requestedCount: 5,
  ...overrides,
});
