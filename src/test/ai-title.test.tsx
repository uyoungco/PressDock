import { StrictMode, useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { TitleOptimizer } from "@/features/ai/TitleOptimizer";
import { MaterialForm } from "@/features/channels/MaterialForm";
import { blankInput } from "@/features/channels/edit-buffer";
import { aiService } from "@/features/ai/service";
import { Provider } from "jotai";
import type { PromoteInput } from "@/types/cms";
import { aiResult, aiSettings } from "./ai-fixtures";
import { deferred, session } from "./cms-fixtures";
import { chooseOption } from "./select-helpers";

vi.mock("@/features/ai/service", () => ({
  aiService: { load: vi.fn(), suggest: vi.fn() },
}));
vi.mock("@/features/channels/use-material-image", () => ({
  useMaterialImage: () => ({
    working: false,
    error: null,
    paste: vi.fn(),
    start: vi.fn(),
    dialog: null,
  }),
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ session }) }));
vi.mock("@/features/auth/service", () => ({
  authService: { getSnapshot: () => ({ status: "authenticated" }) },
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(aiService.load).mockResolvedValue(aiSettings());
  vi.mocked(aiService.suggest).mockResolvedValue(aiResult());
});
function Harness() {
  const [title, setTitle] = useState("当前标题");
  return (
    <>
      <input
        id="title"
        aria-label="标题"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <TitleOptimizer
        title={title}
        content="当前未保存正文"
        titleInputId="title"
        onAdopt={setTitle}
      />
    </>
  );
}
function mount(element = <Harness />) {
  const router = createMemoryRouter(
    [
      { path: "*", element },
      { path: "/settings", element: <h1>配置页面</h1> },
    ],
    { initialEntries: ["/"] },
  );
  return {
    router,
    ...render(
      <Provider>
        <StrictMode>
          <RouterProvider router={router} />
        </StrictMode>
      </Provider>,
    ),
  };
}

it("首次打开仅生成一次，临时参数不自动请求，采用回填并恢复焦点", async () => {
  mount();
  await userEvent.click(screen.getByRole("button", { name: "AI 优化" }));
  await screen.findByText("演示候选标题一");
  expect(aiService.suggest).toHaveBeenCalledTimes(1);
  expect(aiService.suggest).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "当前标题",
      content: "当前未保存正文",
      templateId: "template-1",
      modelConfigId: "model-1",
      candidateCount: 5,
      maxLength: 30,
    }),
    expect.any(AbortSignal),
  );
  await chooseOption(screen.getByLabelText("提示词模板"), "简洁标题");
  expect(screen.getByLabelText("本次使用模型")).toHaveTextContent(
    "演示备用模型",
  );
  expect(screen.getByLabelText("候选数量")).toHaveValue(3);
  expect(screen.queryByText("演示候选标题一")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("最大字数"), {
    target: { value: "18" },
  });
  fireEvent.change(screen.getByLabelText("补充要求（仅本次）"), {
    target: { value: "突出数据" },
  });
  expect(aiService.suggest).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "重新生成" }));
  await screen.findByText("演示候选标题一");
  expect(aiService.suggest).toHaveBeenLastCalledWith(
    expect.objectContaining({
      templateId: "template-2",
      modelConfigId: "model-2",
      maxLength: 18,
      requirements: "突出数据",
    }),
    expect.any(AbortSignal),
  );
  await userEvent.click(screen.getByRole("button", { name: "采用候选 1" }));
  expect(screen.getByLabelText("标题")).toHaveValue("演示候选标题一");
  await waitFor(() => expect(screen.getByLabelText("标题")).toHaveFocus());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("关闭会取消，旧结果不会污染重新打开的弹窗", async () => {
  const pending = deferred<ReturnType<typeof aiResult>>();
  vi.mocked(aiService.suggest).mockReturnValueOnce(pending.promise);
  mount();
  await userEvent.click(screen.getByRole("button", { name: "AI 优化" }));
  await screen.findByText("正在生成候选标题…");
  const signal = vi.mocked(aiService.suggest).mock.calls[0][1]!;
  await userEvent.click(screen.getByRole("button", { name: "取消生成并关闭" }));
  expect(signal.aborted).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "AI 优化" }));
  await screen.findByText("演示候选标题一");
  await act(async () =>
    pending.resolve(aiResult({ candidates: ["过期结果"] })),
  );
  expect(screen.queryByText("过期结果")).not.toBeInTheDocument();
  expect(screen.getByLabelText("标题")).toHaveValue("当前标题");
});
it("失败可手动重试，无默认模板时不擅自调用其他模型", async () => {
  vi.mocked(aiService.suggest).mockRejectedValueOnce(new Error("AI 服务限流"));
  const view = mount();
  await userEvent.click(screen.getByRole("button", { name: "AI 优化" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("限流");
  await userEvent.click(screen.getByRole("button", { name: "重新生成" }));
  await screen.findByText("演示候选标题一");
  view.unmount();
  const settings = aiSettings();
  settings.templates.forEach((t) => {
    t.isDefault = false;
  });
  vi.mocked(aiService.load).mockResolvedValue(settings);
  vi.mocked(aiService.suggest).mockClear();
  mount();
  await userEvent.click(screen.getByRole("button", { name: "AI 优化" }));
  await screen.findByLabelText("提示词模板");
  expect(aiService.suggest).not.toHaveBeenCalled();
});
it("未配置时显示设置入口，点击可到指定设置标签", async () => {
  vi.mocked(aiService.load).mockResolvedValue({
    providers: [],
    models: [],
    templates: [],
  });
  const { router } = mount();
  await userEvent.click(screen.getByRole("button", { name: "AI 优化" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "前往 AI 模型设置" }),
  );
  expect(router.state.location.search).toBe("?tab=ai-models");
  expect(aiService.suggest).not.toHaveBeenCalled();
});
it("内置模板首次绑定模型前不发送请求，即使已有可用模型", async () => {
  const settings = aiSettings();
  settings.templates[0].modelConfigId = null;
  vi.mocked(aiService.load).mockResolvedValue(settings);
  mount();
  await userEvent.click(screen.getByRole("button", { name: "AI 优化" }));
  expect(
    await screen.findByRole("button", { name: "前往提示词模板" }),
  ).toBeEnabled();
  expect(screen.getByRole("button", { name: "重新生成" })).toBeDisabled();
  expect(screen.getByLabelText("本次使用模型")).toBeDisabled();
  expect(aiService.suggest).not.toHaveBeenCalled();
});
it("渠道素材使用当前 Title 和 SmallText，采用不保存素材", async () => {
  const save = vi.fn();
  function MaterialHarness() {
    const [input, setInput] = useState<PromoteInput>({
      ...blankInput(),
      title: "素材当前标题",
      smallText: "素材当前摘要",
    });
    return (
      <MaterialForm
        edit={{ base: null, input }}
        onChange={setInput}
        onClose={vi.fn()}
        onSave={save}
        busy={false}
        onUploading={vi.fn()}
        error={null}
      />
    );
  }
  mount(<MaterialHarness />);
  await userEvent.click(screen.getByRole("button", { name: "AI 优化" }));
  await screen.findByText("演示候选标题一");
  expect(aiService.suggest).toHaveBeenCalledWith(
    expect.objectContaining({ title: "素材当前标题", content: "素材当前摘要" }),
    expect.any(AbortSignal),
  );
  await userEvent.click(screen.getByRole("button", { name: "采用候选 1" }));
  expect(screen.getByLabelText("* Title", { exact: true })).toHaveValue(
    "演示候选标题一",
  );
  expect(save).not.toHaveBeenCalled();
});
