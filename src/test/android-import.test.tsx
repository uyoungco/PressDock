import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppProviders } from "@/app/providers";
import {
  createQueryRuntime,
  harvestUrlAtom,
  resetQueryRuntime,
} from "@/lib/query-runtime";
import { importService } from "@/features/import/service";
import { harvestIpc } from "@/services/tauri/harvest";
import { aiService } from "@/features/ai/service";
import { invalidateClientRequests } from "@/services/tauri/client";
import {
  localCollectionDate,
  type HarvestJob,
  type HarvestSettings,
} from "@/features/import/contracts";
import ImportPage from "@/pages/Import";
import Settings from "@/pages/Settings";
import { deferred, session } from "./cms-fixtures";
import { paginationSettings } from "./ai-fixtures";

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ session }) }));
vi.mock("@/features/image-presets/ImagePresetSettings", () => ({
  ImagePresetSettings: () => <p>桌面图片预设</p>,
}));

const options: HarvestSettings = {
  sourceMode: "webview",
  cdpBrowser: "chrome",
  cdpAddress: null,
  developerMode: false,
  autoClassify: false,
  autoTags: true,
  autoSummary: true,
  aiAutoPaginate: false,
  modelConfigId: null,
  retentionDays: null,
};
const job = (status: HarvestJob["status"], suffix = 1): HarvestJob => ({
  id: `5f3e3406-f3e5-435c-aa72-a4721daa0a0${suffix}`,
  sourceMode: "webview",
  sourceInteraction: status === "waitingUser" ? { kind: "verification" } : null,
  developerMode: false,
  title: `[演示] 采集记录 ${suffix}`,
  url: `https://baijiahao.baidu.com/s?id=${suffix}`,
  collectionDate: localCollectionDate(),
  status,
  stage: status === "running" ? "collecting" : null,
  warnings: [],
  error: null,
  attempts: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cmsArticleId: null,
});
let jobs: HarvestJob[];
let notify: () => void;
beforeEach(() => {
  vi.stubEnv("VITE_PRESSDOCK_PLATFORM", "android");
  invalidateClientRequests();
  jobs = [job("waitingUser")];
  vi.spyOn(importService, "subscribe").mockImplementation(async (listener) => {
    notify = listener;
    return vi.fn<() => void>();
  });
  vi.spyOn(importService, "list").mockImplementation(async () => ({
    jobs: [...jobs],
    maintenanceWarning: null,
  }));
  vi.spyOn(importService, "action").mockResolvedValue(null);
  vi.spyOn(importService, "enqueue").mockResolvedValue(job("queued"));
  vi.spyOn(harvestIpc, "settings").mockResolvedValue({ ...options });
  vi.spyOn(harvestIpc, "saveSettings").mockResolvedValue(null);
  vi.spyOn(harvestIpc, "bridgeStatus").mockRejectedValue(
    new Error("演示：手机不应调用桥接"),
  );
  vi.spyOn(aiService, "load").mockResolvedValue(paginationSettings());
});
afterEach(() => {
  invalidateClientRequests();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function setup(path = "/import") {
  const runtime = createQueryRuntime();
  const router = createMemoryRouter(
    [
      { path: "/import", element: <ImportPage /> },
      { path: "/settings", element: <Settings /> },
      { path: "/away", element: <p>其他演示页面</p> },
    ],
    { initialEntries: [path] },
  );
  render(
    <AppProviders runtime={runtime}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { runtime, router };
}

it("Android 开启状态订阅，卡片保留验证与取消操作，离开页面后仍接收更新", async () => {
  const { router } = setup();
  const record = await screen.findByRole("article", {
    name: "[演示] 采集记录 1",
  });
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  fireEvent.click(within(record).getByRole("button", { name: "打开来源窗口" }));
  await waitFor(() =>
    expect(importService.action).toHaveBeenCalledWith(jobs[0].id, "show"),
  );
  fireEvent.click(
    within(record).getByRole("button", { name: "验证完成，继续" }),
  );
  await waitFor(() =>
    expect(importService.action).toHaveBeenCalledWith(jobs[0].id, "resume"),
  );
  await act(() => router.navigate("/away"));
  jobs = [job("interrupted")];
  act(() => notify());
  await act(() => router.navigate("/import"));
  await screen.findByRole("button", { name: "重试" });
  expect(importService.subscribe).toHaveBeenCalledTimes(1);
});

it("配置往返恢复内存链接，账号缓存重置清除草稿", async () => {
  const { runtime } = setup();
  await screen.findByRole("article");
  fireEvent.change(screen.getByLabelText("文章链接"), {
    target: { value: "https://baijiahao.baidu.com/s?id=demo" },
  });
  fireEvent.click(screen.getByRole("link", { name: "系统设置" }));
  await screen.findByRole("heading", { name: "采集与 AI 处理" });
  fireEvent.click(screen.getByRole("button", { name: "返回上一级" }));
  fireEvent.click(screen.getByRole("button", { name: "返回上一级" }));
  await screen.findByRole("article");
  expect(screen.getByLabelText("文章链接")).toHaveValue(
    "https://baijiahao.baidu.com/s?id=demo",
  );
  act(() => resetQueryRuntime(runtime));
  expect(runtime.store.get(harvestUrlAtom)).toBe("");
});

it("Android 完整设置保留采集深链接，不访问油猴桥接，分页入口定位对应用途", async () => {
  setup("/settings?tab=harvest&returnTo=import");
  await screen.findByLabelText("仅处理，不提交 CMS");
  expect(screen.queryByText("浏览器 CDP")).not.toBeInTheDocument();
  expect(screen.queryByText(/F12/)).not.toBeInTheDocument();
  expect(harvestIpc.bridgeStatus).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "配置默认分页模板" }));
  await screen.findByRole("button", { name: /演示分页模板/ });
  expect(
    screen.getByRole("radiogroup", { name: "模板用途" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("桌面图片预设")).not.toBeInTheDocument();
});

it("提交结果待确认须显式核对；标记未添加不会自动重试", async () => {
  jobs = [job("submissionUnknown")];
  setup();
  fireEvent.click(
    await screen.findByRole("button", { name: "已核对：CMS 未添加" }),
  );
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveAttribute("data-import-dialog", "confirm");
  expect(importService.action).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "确认核对结果" }));
  await waitFor(() =>
    expect(importService.action).toHaveBeenCalledExactlyOnceWith(
      jobs[0].id,
      "confirmNotSubmitted",
    ),
  );
});

it("入队请求未完成时连续提交只创建一个请求，失败保留链接并允许重试", async () => {
  const pending = deferred<HarvestJob>();
  vi.mocked(importService.enqueue).mockReturnValueOnce(pending.promise);
  setup();
  await screen.findByRole("article");
  const field = screen.getByLabelText("文章链接");
  fireEvent.change(field, {
    target: { value: "https://baijiahao.baidu.com/s?id=99" },
  });
  const form = field.closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(importService.enqueue).toHaveBeenCalledTimes(1);
  const requestId = vi.mocked(importService.enqueue).mock.calls[0][0];
  await act(async () => pending.reject(new Error("演示入队失败")));
  expect(field).toHaveValue("https://baijiahao.baidu.com/s?id=99");
  fireEvent.submit(form);
  await waitFor(() =>
    expect(importService.enqueue).toHaveBeenLastCalledWith(
      requestId,
      "https://baijiahao.baidu.com/s?id=99",
    ),
  );
});

it("桌面继续使用三列表格及全部设置模块", async () => {
  vi.stubEnv("VITE_PRESSDOCK_PLATFORM", "desktop");
  const { router } = setup();
  await screen.findByRole("table", { name: "采集记录" });
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
  await act(() => router.navigate("/settings"));
  expect(screen.getAllByRole("tab")).toHaveLength(7);
  expect(screen.getByRole("tab", { name: "常规设置" })).toHaveAttribute(
    "data-state",
    "active",
  );
});
