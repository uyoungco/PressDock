import { z } from "zod";
import { invokeCommand } from "./client";
import {
  settingsSchema,
  saveProviderSchema,
  modelSchema,
  templateSchema,
  suggestionRequestSchema,
  suggestionResultSchema,
  type SaveProviderRequest,
  type AiModelConfig,
  type PromptTemplate,
  type TitleSuggestionRequest,
} from "@/features/ai/contracts";

export const aiIpc = {
  load: () => invokeCommand("ai_load_settings", settingsSchema),
  saveProvider: (request: SaveProviderRequest) =>
    invokeCommand("ai_save_provider", z.null(), {
      request: saveProviderSchema.parse(request),
    }),
  saveModel: (request: AiModelConfig) =>
    invokeCommand("ai_save_model", z.null(), {
      request: modelSchema.parse(request),
    }),
  saveTemplate: (request: PromptTemplate) =>
    invokeCommand("ai_save_template", z.null(), {
      request: templateSchema.parse(request),
    }),
  remove: (kind: "provider" | "model" | "template", id: string) =>
    invokeCommand("ai_delete_config", z.null(), { kind, id }),
  listModels: (jobId: string, providerId: string) =>
    invokeCommand("ai_list_models", z.string().array(), { jobId, providerId }),
  testModel: (jobId: string, modelConfigId: string) =>
    invokeCommand("ai_test_model", z.literal(true), { jobId, modelConfigId }),
  suggest: (request: TitleSuggestionRequest) =>
    invokeCommand("ai_suggest_titles", suggestionResultSchema, {
      request: suggestionRequestSchema.parse(request),
    }),
  cancel: (jobId: string) => invokeCommand("ai_cancel", z.null(), { jobId }),
};
