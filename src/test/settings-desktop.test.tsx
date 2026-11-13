import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import Settings from "@/pages/Settings";
import { aiService } from "@/features/ai/service";
import { paginationSettings } from "./ai-fixtures";
import { deferred } from "./cms-fixtures";
import { chooseOption } from "./select-helpers";
import { settingsSyncIpc } from "@/services/tauri/settings-sync";
import { settingsSyncService } from "@/features/settings-sync/service";
import { settingsActivity } from "@/features/settings-sync/activity";
import { invalidateClientRequests } from "@/services/tauri/client";
import { readySyncStatus } from "./settings-sync-fixtures";

vi.mock("@/services/tauri/settings-sync", () => ({
  settingsSyncIpc: {
    start: vi.fn(),
    manual: vi.fn(),
    status: vi.fn(),
    wake: vi.fn(),
    resolve: vi.fn(),
  },
}));

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
let saved = paginationSettings();
it("正文整理模板有独立用途和草稿，新建与复制不带标题或分页参数", async () => {
  setup("ai-templates&purpose=bodyOrganization");
  await userEvent.click(
    await screen.findByRole("button", { name: "新增模板" }),
  );
  expect(
    (screen.getByLabelText("系统指令") as HTMLTextAreaElement).value,
  ).toContain("排版编辑");
  expect(screen.getByLabelText("用户提示词")).toHaveValue(
    "标题：{{title}}\n内容块：{{blocks}}",
  );
  expect(screen.queryByLabelText("候选数量")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("目标字数")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "{{content}}" }),
  ).not.toBeInTheDocument();
  change("模板名称", "演示正文整理");
  await userEvent.click(screen.getByRole("button", { name: "保存模板" }));
  await waitFor(() =>
    expect(aiService.saveTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "bodyOrganization",
        paginationOptions: null,
        name: "演示正文整理",
      }),
      undefined,
    ),
  );
  expect(saved.templates.find((t) => t.purpose === "title")?.isDefault).toBe(
    true,
  );
  await userEvent.click(screen.getByRole("button", { name: "复制模板" }));
  expect(screen.getByLabelText("模板名称")).toHaveValue("演示正文整理（副本）");
  await userEvent.click(screen.getByRole("radio", { name: "文章分页" }));
  await userEvent.click(screen.getByRole("radio", { name: "正文整理" }));
  expect(screen.getByLabelText("模板名称")).toHaveValue("演示正文整理（副本）");
});
beforeEach(() => {
  invalidateClientRequests();
  vi.clearAllMocks();
  saved = paginationSettings();
  vi.mocked(settingsSyncIpc.start).mockResolvedValue(readySyncStatus);
  vi.mocked(settingsSyncIpc.manual).mockResolvedValue({
    ...readySyncStatus,
    successfulReads: 2,
    readRequests: 2,
  });
  vi.mocked(aiService.load).mockImplementation(async () =>
    structuredClone(saved),
  );
  vi.mocked(aiService.saveProvider).mockResolvedValue(null);
  vi.mocked(aiService.saveModel).mockResolvedValue(null);
  vi.mocked(aiService.saveTemplate).mockImplementation(async (template) => {
    saved.templates = [
      ...saved.templates.filter((t) => t.id !== template.id),
      template,
    ];
    return null;
  });
  vi.mocked(aiService.remove).mockImplementation(async (kind, id) => {
    if (kind === "template")
      saved.templates = saved.templates.filter((t) => t.id !== id);
    return null;
  });
});

it("手动同步刷新模型摘要与保存基线，并在请求期间锁定编辑", async () => {
  await settingsSyncService.start();
  setup();
  await screen.findByText("https://gateway.example/v1");
  await waitFor(() => expect(settingsActivity.getSnapshot().busy).toBe(false));
  const request = deferred<typeof readySyncStatus>();
  vi.mocked(settingsSyncIpc.manual).mockReturnValueOnce(request.promise);
  fireEvent.click(screen.getByRole("button", { name: "手动同步" }));
  expect(screen.getByRole("button", { name: "编辑提供商" })).toBeDisabled();
  saved.providers[0].displayName = "演示云端提供商";
  await act(async () =>
    request.resolve({
      ...readySyncStatus,
      successfulReads: 2,
      readRequests: 2,
    }),
  );
  await screen.findByRole("button", { name: /演示云端提供商/ });
  const dialog = await providerEditor();
  expect(screen.getByLabelText("显示名称")).toHaveValue("演示云端提供商");
  change("显示名称", "同步后的本机修改");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "保存提供商" }),
  );
  await waitFor(() =>
    expect(aiService.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "同步后的本机修改" }),
      expect.objectContaining({ displayName: "演示云端提供商" }),
    ),
  );
});

it("未保存模板在切换模块后继续阻止同步，同步成功刷新所选模板", async () => {
  await settingsSyncService.start();
  const router = setup("ai-templates");
  await screen.findByLabelText("模板名称");
  const initial = (screen.getByLabelText("模板名称") as HTMLInputElement).value;
  change("模板名称", "演示未保存模板");
  await act(() => router.navigate("/settings?tab=ai-models"));
  await waitFor(() => expect(settingsActivity.getSnapshot().busy).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "手动同步" }));
  expect(await screen.findByText("请先保存或取消编辑")).toBeVisible();
  expect(settingsSyncIpc.manual).not.toHaveBeenCalled();
  await act(() => router.navigate("/settings?tab=ai-templates"));
  expect(screen.getByLabelText("模板名称")).toHaveValue("演示未保存模板");
  change("模板名称", initial);
  const selectedId = saved.templates.find(
    (template) => template.name === initial,
  )!.id;
  vi.mocked(settingsSyncIpc.manual).mockImplementationOnce(async () => {
    saved.templates.find((template) => template.id === selectedId)!.name =
      "演示云端模板";
    return { ...readySyncStatus, successfulReads: 2, readRequests: 2 };
  });
  fireEvent.click(screen.getByRole("button", { name: "手动同步" }));
  await waitFor(() =>
    expect(screen.getByLabelText("模板名称")).toHaveValue("演示云端模板"),
  );
  change("模板名称", "同步后的模板修改");
  await userEvent.click(screen.getByRole("button", { name: "保存模板" }));
  await waitFor(() =>
    expect(aiService.saveTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "同步后的模板修改" }),
      expect.objectContaining({ name: "演示云端模板" }),
    ),
  );
});
function setup(tab = "ai-models") {
  const router = createMemoryRouter(
    [
      { path: "/settings", element: <Settings /> },
      { path: "/other", element: <p>其他页面</p> },
    ],
    { initialEntries: [`/settings?tab=${tab}`] },
  );
  render(<RouterProvider router={router} />);
  return router;
}
const change = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
async function providerEditor() {
  await userEvent.click(
    await screen.findByRole("button", { name: "编辑提供商" }),
  );
  return screen.getByRole("dialog", { name: "编辑提供商" });
}

it("模型默认展示已保存摘要，编辑弹框失败保留输入、请求期间锁定，空密钥仍传 null", async () => {
  setup();
  expect(await screen.findByText("https://gateway.example/v1")).toBeVisible();
  expect(screen.queryByLabelText("显示名称")).not.toBeInTheDocument();
  const dialog = await providerEditor();
  const pending = deferred<null>();
  vi.mocked(aiService.saveProvider).mockReturnValueOnce(pending.promise);
  change("显示名称", "新的演示网关");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "保存提供商" }),
  );
  expect(aiService.saveProvider).toHaveBeenCalledWith(
    expect.objectContaining({
      apiKey: null,
      displayName: "新的演示网关",
      createOnly: false,
    }),
    expect.objectContaining({ id: "demo-gateway" }),
  );
  expect(within(dialog).getByRole("button", { name: "关闭" })).toBeDisabled();
  fireEvent.submit(document.getElementById("settings-provider-form")!);
  expect(aiService.saveProvider).toHaveBeenCalledTimes(1);
  pending.reject(new Error("隔离演示：写入失败"));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "写入失败",
  );
  expect(screen.getByLabelText("显示名称")).toHaveValue("新的演示网关");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "保存提供商" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});

it("提供商弹框保留草稿、Esc 确认及显式丢弃互不混淆，协议仍联动兼容项", async () => {
  setup();
  await providerEditor();
  change("显示名称", "未保存网关");
  await userEvent.keyboard("{Escape}");
  await userEvent.click(screen.getByRole("button", { name: "保留草稿并关闭" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "编辑提供商" })).toHaveFocus(),
  );
  await providerEditor();
  expect(screen.getByLabelText("显示名称")).toHaveValue("未保存网关");
  await chooseOption(screen.getByLabelText("API 协议"), "OpenAI Responses");
  await userEvent.click(screen.getByText("网关兼容设置"));
  expect(screen.queryByLabelText("输出 token 参数")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "关闭" }));
  await userEvent.click(screen.getByRole("button", { name: "丢弃修改" }));
  await providerEditor();
  expect(screen.getByLabelText("显示名称")).toHaveValue("演示网关");
});

it("保存已有提供商不会清除尚未保存的新提供商草稿", async () => {
  setup();
  await screen.findByRole("button", { name: "编辑提供商" });
  await userEvent.click(screen.getByRole("button", { name: "新增提供商" }));
  change("提供商标识", "another-demo");
  change("显示名称", "新的提供商草稿");
  change("API 地址", "https://demo.invalid/v1");
  await userEvent.click(screen.getByRole("button", { name: "关闭" }));
  await userEvent.click(screen.getByRole("button", { name: "保留草稿并关闭" }));
  await providerEditor();
  change("显示名称", "修改已有网关");
  await userEvent.click(screen.getByRole("button", { name: "保存提供商" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await userEvent.click(screen.getByRole("button", { name: "继续新增提供商" }));
  expect(screen.getByLabelText("提供商标识")).toHaveValue("another-demo");
  expect(screen.getByLabelText("显示名称")).toHaveValue("新的提供商草稿");
  expect(screen.getByLabelText("提供商标识")).toBeEnabled();
});

it("模型编辑失败和返回列表均保留同一模型草稿，只有成功后关闭", async () => {
  setup();
  await screen.findByText("https://gateway.example/v1");
  await userEvent.click(screen.getAllByRole("button", { name: "编辑" })[0]);
  change("模型显示名称", "待保存模型");
  await userEvent.click(screen.getByRole("button", { name: "关闭" }));
  await userEvent.click(screen.getByRole("button", { name: "保留草稿并关闭" }));
  await userEvent.click(screen.getAllByRole("button", { name: "编辑" })[0]);
  expect(screen.getByLabelText("模型显示名称")).toHaveValue("待保存模型");
  vi.mocked(aiService.saveModel).mockRejectedValueOnce(
    new Error("模型保存失败"),
  );
  await userEvent.click(screen.getByRole("button", { name: "保存模型" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("模型保存失败");
  expect(screen.getByLabelText("模型显示名称")).toHaveValue("待保存模型");
  await userEvent.click(screen.getByRole("button", { name: "保存模型" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});

it("模板按 ID 缓存，切条目、用途、模块及历史返回都保留输入", async () => {
  const router = setup("ai-templates");
  await screen.findByDisplayValue("新闻标题优化");
  change("模板名称", "标题草稿一");
  await userEvent.click(screen.getByRole("button", { name: "简洁标题" }));
  change("模板名称", "标题草稿二");
  await userEvent.click(screen.getByRole("radio", { name: "文章分页" }));
  await screen.findByDisplayValue("演示分页模板");
  change("模板名称", "分页草稿");
  await userEvent.click(screen.getByRole("tab", { name: "关于应用" }));
  await act(async () => {
    await router.navigate(-1);
  });
  expect(router.state.location.search).toContain("tab=ai-templates");
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: "提示词模板" })).toHaveAttribute(
      "aria-selected",
      "true",
    ),
  );
  expect(screen.getByLabelText("模板名称")).toHaveValue("分页草稿");
  await userEvent.click(screen.getByRole("radio", { name: "标题优化" }));
  expect(screen.getByLabelText("模板名称")).toHaveValue("标题草稿二");
  await userEvent.click(screen.getByRole("button", { name: /新闻标题优化/ }));
  expect(screen.getByLabelText("模板名称")).toHaveValue("标题草稿一");
  expect(aiService.saveTemplate).not.toHaveBeenCalled();
});

it("变量插入最近聚焦的光标，保存一个模板不会清掉其他模板草稿", async () => {
  const router = setup("ai-templates");
  await screen.findByDisplayValue("新闻标题优化");
  change("模板名称", "未保存的另一模板");
  await userEvent.click(screen.getByRole("button", { name: "简洁标题" }));
  const prompt = screen.getByLabelText("系统指令") as HTMLTextAreaElement;
  fireEvent.focus(prompt);
  prompt.setSelectionRange(1, 1);
  await userEvent.click(screen.getByRole("button", { name: "{{title}}" }));
  expect(prompt).toHaveValue("简{{title}}洁");
  await userEvent.click(screen.getByRole("button", { name: "保存模板" }));
  await waitFor(() =>
    expect(aiService.saveTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "template-2",
        systemPrompt: "简{{title}}洁",
      }),
      expect.objectContaining({ id: "template-2" }),
    ),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "保存模板" })).toBeEnabled(),
  );
  await router.navigate("/other");
  expect(
    await screen.findByRole("dialog", { name: "离开系统设置？" }),
  ).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "留在设置" }));
  await userEvent.click(screen.getByRole("button", { name: /新闻标题优化/ }));
  expect(screen.getByLabelText("模板名称")).toHaveValue("未保存的另一模板");
});

it("删除默认模板二次确认，不自动指定其他默认模板", async () => {
  setup("ai-templates");
  await screen.findByDisplayValue("新闻标题优化");
  await userEvent.click(screen.getByRole("button", { name: "删除模板" }));
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "删除后不自动选择其他默认模板",
  );
  await userEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await screen.findByDisplayValue("简洁标题");
  expect(
    screen.getByRole("checkbox", { name: "设为默认模板" }),
  ).not.toBeChecked();
  expect(aiService.saveTemplate).not.toHaveBeenCalled();
});

it("离开设置可取消或明确丢弃，服务配置状态不会宣称模型已连通", async () => {
  const router = setup("ai-templates");
  await screen.findByDisplayValue("新闻标题优化");
  change("模板名称", "离开测试草稿");
  await userEvent.click(screen.getByRole("tab", { name: "服务连接" }));
  expect(await screen.findByText("1 个提供商 · 2 个模型")).toBeVisible();
  expect(screen.getByText(/已配置不代表已连通/)).toBeVisible();
  expect(screen.queryByText("已登录 · 只读素材")).not.toBeInTheDocument();
  await router.navigate("/other");
  await userEvent.click(
    await screen.findByRole("button", { name: "丢弃修改并离开" }),
  );
  expect(await screen.findByText("其他页面")).toBeVisible();
});
