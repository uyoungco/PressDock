import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ModelSettings } from "@/features/ai/ModelSettings";
import { TemplateSettings } from "@/features/ai/TemplateSettings";
import { aiService } from "@/features/ai/service";
import { aiSettings } from "./ai-fixtures";
import { chooseOption } from "./select-helpers";
import { deferred } from "./cms-fixtures";
import Settings from "@/pages/Settings";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

vi.mock("@/features/ai/service", () => ({
  aiService: {
    load: vi.fn(),
    saveProvider: vi.fn(),
    saveModel: vi.fn(),
    saveTemplate: vi.fn(),
    remove: vi.fn(),
    listModels: vi.fn(),
    testModel: vi.fn(),
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(aiService.load).mockResolvedValue(aiSettings());
  vi.mocked(aiService.saveProvider).mockResolvedValue(null);
  vi.mocked(aiService.saveModel).mockResolvedValue(null);
  vi.mocked(aiService.saveTemplate).mockResolvedValue(null);
  vi.mocked(aiService.remove).mockResolvedValue(null);
  vi.mocked(aiService.testModel).mockResolvedValue(true);
});
const change = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });

it("设置页可直接打开 AI 标签，两个设置标签切换保留各自未保存编辑", async () => {
  const router = createMemoryRouter(
    [{ path: "/settings", element: <Settings /> }],
    { initialEntries: ["/settings?tab=ai-models"] },
  );
  render(<RouterProvider router={router} />);
  expect(screen.getByRole("tab", { name: "AI 模型" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await userEvent.click(
    await screen.findByRole("button", { name: /演示网关/ }),
  );
  change("显示名称", "尚未保存的网关");
  await userEvent.click(screen.getByRole("tab", { name: "提示词模板" }));
  await userEvent.click(
    await screen.findByRole("button", { name: /新闻标题优化/ }),
  );
  change("模板名称", "尚未保存的模板");
  await userEvent.click(screen.getByRole("tab", { name: "AI 模型" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "保存提供商" })).toBeEnabled(),
  );
  expect(screen.getByLabelText("显示名称")).toHaveValue("尚未保存的网关");
  await userEvent.click(screen.getByRole("tab", { name: "提示词模板" }));
  expect(screen.getByLabelText("模板名称")).toHaveValue("尚未保存的模板");
  expect(aiService.saveProvider).not.toHaveBeenCalled();
  expect(aiService.saveTemplate).not.toHaveBeenCalled();
});

it("提供商保存留空密钥保留旧值，隐藏标签后表单仍保留", async () => {
  const view = render(<ModelSettings active />);
  await userEvent.click(
    await screen.findByRole("button", { name: /演示网关/ }),
  );
  expect(screen.getByLabelText("提供商标识")).toBeDisabled();
  expect(screen.getByLabelText("API 密钥")).toHaveValue("");
  change("显示名称", "新的网关名称");
  view.rerender(<ModelSettings active={false} />);
  view.rerender(<ModelSettings active />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "保存提供商" })).toBeEnabled(),
  );
  expect(screen.getByLabelText("显示名称")).toHaveValue("新的网关名称");
  await userEvent.click(screen.getByRole("button", { name: "保存提供商" }));
  await waitFor(() =>
    expect(aiService.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "demo-gateway",
        apiKey: null,
        displayName: "新的网关名称",
      }),
    ),
  );
});
it("拉取失败后仍可手填模型，可选参数留空为 null", async () => {
  vi.mocked(aiService.listModels).mockRejectedValue(
    new Error("列表接口不可用，请手填"),
  );
  render(<ModelSettings active />);
  await userEvent.click(
    await screen.findByRole("button", { name: /演示网关/ }),
  );
  await userEvent.click(screen.getByRole("button", { name: "获取可用模型" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("请手填");
  await userEvent.click(screen.getByRole("button", { name: "添加模型" }));
  change("模型 ID", "manual-model");
  change("模型显示名称", "手填模型");
  await userEvent.click(screen.getByRole("button", { name: "保存模型" }));
  await waitFor(() =>
    expect(aiService.saveModel).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "manual-model",
        contextWindow: null,
        maxOutputTokens: null,
        reasoningEffort: null,
      }),
    ),
  );
});
it("模型测试期间阻止重复操作，关闭页面会取消模型测试", async () => {
  const pending = deferred<true>();
  vi.mocked(aiService.testModel).mockReturnValue(pending.promise);
  const view = render(<ModelSettings active />);
  await userEvent.click(
    await screen.findByRole("button", { name: /演示网关/ }),
  );
  await userEvent.click(screen.getAllByRole("button", { name: "测试" })[0]);
  expect(screen.getAllByRole("button", { name: "测试" })[0]).toBeDisabled();
  const signal = vi.mocked(aiService.testModel).mock.calls[0][1]!;
  view.unmount();
  expect(signal.aborted).toBe(true);
  pending.resolve(true);
});
it("模板支持绑定、变量插入、复制和默认标记，标签切换保留编辑", async () => {
  const view = render(<TemplateSettings active />);
  await userEvent.click(
    await screen.findByRole("button", { name: /新闻标题优化/ }),
  );
  change("模板名称", "数据新闻标题");
  await chooseOption(
    screen.getByLabelText("绑定模型"),
    "演示网关 / 演示备用模型",
  );
  const prompt = screen.getByLabelText("用户提示词") as HTMLTextAreaElement;
  fireEvent.focus(prompt);
  prompt.setSelectionRange(prompt.value.length, prompt.value.length);
  await userEvent.click(screen.getByRole("button", { name: "{{title}}" }));
  expect(prompt.value.endsWith("{{title}}")).toBe(true);
  view.rerender(<TemplateSettings active={false} />);
  view.rerender(<TemplateSettings active />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "保存模板" })).toBeEnabled(),
  );
  expect(screen.getByLabelText("模板名称")).toHaveValue("数据新闻标题");
  await userEvent.click(screen.getByRole("button", { name: "复制模板" }));
  expect(screen.getByLabelText("设为默认模板")).not.toBeChecked();
  await userEvent.click(screen.getByLabelText("设为默认模板"));
  await userEvent.click(screen.getByRole("button", { name: "保存模板" }));
  await waitFor(() =>
    expect(aiService.saveTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "数据新闻标题（副本）",
        modelConfigId: "model-2",
        isDefault: true,
      }),
    ),
  );
  expect(vi.mocked(aiService.saveTemplate).mock.calls[0][0].id).not.toBe(
    "template-1",
  );
});
it("未知模板变量阻止保存，失败保留输入", async () => {
  render(<TemplateSettings active />);
  await userEvent.click(
    await screen.findByRole("button", { name: /新闻标题优化/ }),
  );
  change("用户提示词", "{{unknown}}");
  await userEvent.click(screen.getByRole("button", { name: "保存模板" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("未知");
  expect(aiService.saveTemplate).not.toHaveBeenCalled();
  expect(screen.getByLabelText("用户提示词")).toHaveValue("{{unknown}}");
});
