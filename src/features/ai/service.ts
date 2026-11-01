import { aiIpc } from "@/services/tauri/ai";
import { onClientInvalidated, ServiceError } from "@/services/tauri/client";
import {
  suggestionRequestSchema,
  type TitleSuggestionRequest,
  paginationRequestSchema,
  type PaginationRequest,
} from "./contracts";
import {
  validateSemanticPagination,
  validatePaginationBoundaries,
} from "./pagination";

const active = new Map<string, AbortController>();
onClientInvalidated(() => {
  for (const controller of active.values()) controller.abort();
});
const cancelled = () => new ServiceError("AI_CANCELLED", "AI 请求已取消");
async function operation<T>(
  run: (id: string) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const id = crypto.randomUUID();
  const controller = new AbortController();
  const stop = () => controller.abort();
  const cancel = () => {
    void aiIpc.cancel(id).catch(() => undefined);
  };
  active.set(id, controller);
  signal?.addEventListener("abort", stop, { once: true });
  controller.signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal?.aborted) controller.abort();
    if (controller.signal.aborted) throw cancelled();
    const result = await run(id);
    if (controller.signal.aborted) throw cancelled();
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw cancelled();
    throw error;
  } finally {
    active.delete(id);
    signal?.removeEventListener("abort", stop);
    controller.signal.removeEventListener("abort", cancel);
  }
}
export const aiService = {
  paginate: (input: Omit<PaginationRequest, "jobId">, signal?: AbortSignal) =>
    operation(async (id) => {
      const request = paginationRequestSchema.parse({ ...input, jobId: id });
      const result = await aiIpc.paginate(request);
      if (
        result.jobId !== id ||
        result.templateId !== input.templateId ||
        result.modelConfigId !== input.modelConfigId
      )
        throw new Error("AI 分页结果与本次请求不符");
      validateSemanticPagination(
        { bind_after: result.bind_after, prefer_after: result.prefer_after },
        input.blocks,
      );
      validatePaginationBoundaries(result.breakAfter, input.blocks);
      return result;
    }, signal),
  load: aiIpc.load,
  saveProvider: aiIpc.saveProvider,
  saveModel: aiIpc.saveModel,
  saveTemplate: aiIpc.saveTemplate,
  remove: aiIpc.remove,
  listModels: (providerId: string, signal?: AbortSignal) =>
    operation((id) => aiIpc.listModels(id, providerId), signal),
  testModel: (modelConfigId: string, signal?: AbortSignal) =>
    operation((id) => aiIpc.testModel(id, modelConfigId), signal),
  suggest: (
    input: Omit<TitleSuggestionRequest, "jobId">,
    signal?: AbortSignal,
  ) =>
    operation(async (id) => {
      const request = suggestionRequestSchema.parse({ ...input, jobId: id });
      const result = await aiIpc.suggest(request);
      const maxLength = input.maxLength ?? 200;
      if (
        result.jobId !== id ||
        result.templateId !== input.templateId ||
        (input.modelConfigId && result.modelConfigId !== input.modelConfigId) ||
        result.candidates.some((title) => [...title].length > maxLength)
      )
        throw new Error("AI 返回的候选与本次请求不符，请重试");
      return result;
    }, signal),
};
