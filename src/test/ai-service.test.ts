import { beforeEach, expect, it, vi } from "vitest";
import { aiService } from "@/features/ai/service";
import { aiIpc } from "@/services/tauri/ai";
import { invalidateClientRequests } from "@/services/tauri/client";
import {
  modelSchema,
  saveProviderSchema,
  templateSchema,
} from "@/features/ai/contracts";
import { aiResult, aiSettings } from "./ai-fixtures";
import { deferred } from "./cms-fixtures";

vi.mock("@/services/tauri/ai", () => ({
  aiIpc: {
    load: vi.fn(),
    saveProvider: vi.fn(),
    saveModel: vi.fn(),
    saveTemplate: vi.fn(),
    remove: vi.fn(),
    listModels: vi.fn(),
    testModel: vi.fn(),
    suggest: vi.fn(),
    paginate: vi.fn(),
    cancel: vi.fn(async () => null),
  },
}));
const input = {
  templateId: "template-1",
  title: "待优化标题",
  content: "当前编辑正文",
  modelConfigId: "model-1",
  candidateCount: 5,
  maxLength: 30,
  requirements: "突出事实",
};
beforeEach(() => {
  vi.clearAllMocks();
});

it("边界和模板变量校验与后端一致，网关字段通过类型化契约", () => {
  const settings = aiSettings();
  expect(
    templateSchema.safeParse({
      ...settings.templates[0],
      userPrompt: "{{unrecognized}}",
    }).success,
  ).toBe(false);
  expect(
    templateSchema.safeParse({
      ...settings.templates[0],
      userPrompt: "{{title",
    }).success,
  ).toBe(false);
  expect(
    templateSchema.safeParse({ ...settings.templates[0], candidateCount: 11 })
      .success,
  ).toBe(false);
  expect(
    templateSchema.safeParse({ ...settings.templates[0], maxLength: 201 })
      .success,
  ).toBe(false);
  expect(
    modelSchema.safeParse({
      ...settings.models[0],
      contextWindow: 100,
      maxOutputTokens: 101,
    }).success,
  ).toBe(false);
  expect(
    saveProviderSchema.safeParse({
      ...settings.providers[0],
      apiKey: "secret\nheader",
    }).success,
  ).toBe(false);
  expect(
    saveProviderSchema.safeParse({
      ...settings.providers[0],
      baseUrl: "http://remote.example",
    }).success,
  ).toBe(false);
});
it("空输入不调用模型，返回结果核对任务及模型", async () => {
  await expect(
    aiService.suggest({ ...input, title: " ", content: "" }),
  ).rejects.toThrow();
  expect(aiIpc.suggest).not.toHaveBeenCalled();
  vi.mocked(aiIpc.suggest).mockImplementation(async (request) =>
    aiResult({ jobId: request.jobId, modelConfigId: "wrong-model" }),
  );
  await expect(aiService.suggest(input)).rejects.toThrow("本次请求不符");
});
it("关闭取消及登录变化都取消原生任务并拒绝迟到结果", async () => {
  for (const invalidate of [false, true]) {
    const pending = deferred<ReturnType<typeof aiResult>>();
    vi.mocked(aiIpc.suggest).mockReturnValue(pending.promise);
    const controller = new AbortController();
    const task = aiService.suggest(input, controller.signal);
    const assertion = expect(task).rejects.toMatchObject({
      code: "AI_CANCELLED",
    });
    const calls = vi.mocked(aiIpc.suggest).mock.calls;
    const request = calls[calls.length - 1][0];
    if (invalidate) invalidateClientRequests();
    else controller.abort();
    expect(aiIpc.cancel).toHaveBeenCalledWith(request.jobId);
    pending.resolve(aiResult({ jobId: request.jobId }));
    await assertion;
  }
});
it("网络错误仅尝试一次，预先取消不启动请求", async () => {
  vi.mocked(aiIpc.suggest).mockRejectedValue(new Error("连接失败"));
  await expect(aiService.suggest(input)).rejects.toThrow("连接失败");
  expect(aiIpc.suggest).toHaveBeenCalledTimes(1);
  const controller = new AbortController();
  controller.abort();
  await expect(
    aiService.suggest(input, controller.signal),
  ).rejects.toMatchObject({ code: "AI_CANCELLED" });
  expect(aiIpc.suggest).toHaveBeenCalledTimes(1);
});

it("分页服务核对任务身份、语义编号并取消迟到结果", async () => {
  const input = {
    title: "【演示数据】分页文章",
    templateId: "pagination-1",
    modelConfigId: "model-1",
    blocks: [
      {
        id: "B1",
        type: "text" as const,
        text: "演示正文",
        chars: 4,
        paragraph: 0,
      },
    ],
  };
  vi.mocked(aiIpc.paginate).mockImplementation(async (r) => ({
    jobId: r.jobId,
    templateId: r.templateId,
    modelConfigId: r.modelConfigId,
    bind_after: ["B99"],
    prefer_after: [],
    breakAfter: ["B1"],
    paginationOptions: { minChars: 100, targetChars: 240, maxChars: 400 },
  }));
  await expect(aiService.paginate(input)).rejects.toThrow("编号无效");
  vi.mocked(aiIpc.paginate).mockImplementation(async (r) => ({
    jobId: r.jobId,
    templateId: r.templateId,
    modelConfigId: "wrong",
    bind_after: [],
    prefer_after: [],
    breakAfter: ["B1"],
    paginationOptions: { minChars: 100, targetChars: 240, maxChars: 400 },
  }));
  await expect(aiService.paginate(input)).rejects.toThrow("本次请求不符");
  const pending = deferred<Awaited<ReturnType<typeof aiIpc.paginate>>>();
  vi.mocked(aiIpc.paginate).mockReturnValue(pending.promise);
  const controller = new AbortController();
  const task = aiService.paginate(input, controller.signal);
  const assertion = expect(task).rejects.toMatchObject({
    code: "AI_CANCELLED",
  });
  const request = vi.mocked(aiIpc.paginate).mock.calls[2][0];
  controller.abort();
  expect(aiIpc.cancel).toHaveBeenCalledWith(request.jobId);
  pending.resolve({
    jobId: request.jobId,
    templateId: request.templateId,
    modelConfigId: request.modelConfigId,
    bind_after: [],
    prefer_after: [],
    breakAfter: ["B1"],
    paginationOptions: { minChars: 100, targetChars: 240, maxChars: 400 },
  });
  await assertion;
});
