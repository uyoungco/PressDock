import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppProviders } from "@/app/providers";
import { createQueryRuntime } from "@/lib/query-runtime";
import { importService } from "@/features/import/service";
import {
  localCollectionDate,
  type HarvestJob,
} from "@/features/import/contracts";
import { columnStorageKey } from "@/hooks/use-column-preferences";
import ImportPage from "@/pages/Import";
import { deferred, session } from "./cms-fixtures";

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ session }) }));
const job = (status: HarvestJob["status"], index = 1): HarvestJob => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  title: `[演示] 采集文章 ${index}`,
  url: `https://baijiahao.baidu.com/s?id=${index}`,
  sourceMode: "webview",
  sourceInteraction: status === "waitingUser" ? { kind: "verification" } : null,
  collectionDate: localCollectionDate(),
  developerMode: status === "debugCompleted",
  status,
  stage: status === "running" ? "formatting" : null,
  warnings: [],
  error: null,
  attempts: 1,
  createdAt: "2026-11-06T01:42:00Z",
  updatedAt: "2026-11-06T01:42:00Z",
  cmsArticleId: null,
});
let jobs: HarvestJob[];
let width: number;
let resize: () => void;
let notify: () => void;
beforeEach(() => {
  vi.stubEnv("VITE_PRESSDOCK_PLATFORM", "desktop");
  jobs = [job("running")];
  width = 1024;
  resize = () => {};
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.dataset.slot === "import-container"
        ? DOMRect.fromRect({ width, height: 680 })
        : original.call(this);
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        if (target.getAttribute("data-slot") === "import-container")
          resize = () => this.callback([], this);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(importService, "list").mockImplementation(async () => ({
    jobs: [...jobs],
    maintenanceWarning: null,
  }));
  vi.spyOn(importService, "subscribe").mockImplementation(async (callback) => {
    notify = callback;
    return vi.fn<() => void>();
  });
  vi.spyOn(importService, "action").mockResolvedValue(null);
  vi.spyOn(importService, "enqueue").mockResolvedValue(job("queued"));
  vi.spyOn(importService, "openSource").mockResolvedValue(null);
  vi.spyOn(importService, "selectSourceTab").mockResolvedValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function setup() {
  const router = createMemoryRouter(
    [
      { path: "/import", element: <ImportPage /> },
      { path: "/settings", element: <p>演示采集设置</p> },
    ],
    { initialEntries: ["/import"] },
  );
  const runtime = createQueryRuntime();
  const view = render(
    <AppProviders runtime={runtime}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...view, router };
}
const row = (index: number) =>
  screen.getByRole("row", { name: `[演示] 采集文章 ${index}` });

it("桌面三列聚合来源和时间，保留原文及采集设置入口，统计全部需处理状态", async () => {
  jobs = [
    "queued",
    "running",
    "waitingUser",
    "waitingLogin",
    "failed",
    "interrupted",
    "submissionUnknown",
    "succeeded",
    "debugCompleted",
    "cancelled",
  ].map((status, i) => job(status as HarvestJob["status"], i + 1));
  setup();
  const table = await screen.findByRole("table", { name: "采集记录" });
  expect(within(table).getAllByRole("columnheader")).toHaveLength(3);
  expect(
    within(table).getByRole("columnheader", { name: "新闻内容" }),
  ).toBeInTheDocument();
  expect(screen.getByText("5 条需处理")).toBeInTheDocument();
  expect(within(row(1)).getByText("baijiahao.baidu.com")).toHaveAttribute(
    "title",
    jobs[0].url,
  );
  expect(row(1).querySelector("time")).toHaveAttribute(
    "datetime",
    jobs[0].createdAt,
  );
  expect(screen.getByRole("link", { name: "采集设置" })).toHaveAttribute(
    "href",
    "/settings?tab=harvest&returnTo=import",
  );
  await userEvent.click(within(row(1)).getByRole("link"));
  expect(importService.openSource).toHaveBeenCalledExactlyOnceWith(jobs[0].url);
});

it("按工作区宽度在三列表格和卡片间切换，并在恢复宽度后保留数据及未提交输入", async () => {
  setup();
  await screen.findByRole("table");
  fireEvent.change(screen.getByLabelText("文章链接"), {
    target: { value: "https://mbd.baidu.com/new" },
  });
  act(() => {
    width = 639;
    resize();
  });
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(
    screen.getByRole("article", { name: jobs[0].title! }),
  ).toHaveTextContent("格式化中");
  act(() => {
    width = 640;
    resize();
  });
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(
    screen.getByRole("separator", { name: "调整 状态 列宽" }),
  ).toHaveAttribute("aria-valuenow", "208");
  act(() => {
    width = 960;
    resize();
  });
  expect(
    screen.getByRole("separator", { name: "调整 状态 列宽" }),
  ).toHaveAttribute("aria-valuenow", "248");
  expect(screen.getByLabelText("文章链接")).toHaveValue(
    "https://mbd.baidu.com/new",
  );
  expect(importService.list).toHaveBeenCalledTimes(1);
});

it("旧列宽在窄宽表格间保留，恢复默认宽度后标题重新伸展", async () => {
  localStorage.setItem(
    columnStorageKey("import"),
    JSON.stringify({
      version: 1,
      visibility: {},
      sizing: { title: 600, status: 340, actions: 280 },
    }),
  );
  setup();
  await screen.findByRole("table");
  act(() => {
    width = 736;
    resize();
  });
  expect(
    screen.getByRole("separator", { name: "调整 状态 列宽" }),
  ).toHaveAttribute("aria-valuenow", "340");
  expect(screen.getByRole("table").style.width).toBe("1220px");
  fireEvent.keyDown(
    screen.getByRole("separator", { name: "调整 新闻内容 列宽" }),
    { key: "Home" },
  );
  expect(screen.getByRole("table").style.width).toBe("100%");
  expect(
    JSON.parse(localStorage.getItem(columnStorageKey("import"))!).sizing,
  ).toEqual({ status: 340, actions: 280 });
});

it("保留完整错误及全部警告，删除只通过更多菜单确认执行", async () => {
  jobs = [
    {
      ...job("failed"),
      error: "演示错误详情不能丢失",
      warnings: ["演示警告一", "演示警告二"],
    },
  ];
  setup();
  await screen.findByRole("table");
  expect(row(1)).toHaveTextContent("演示错误详情不能丢失");
  expect(row(1)).toHaveTextContent("演示警告二");
  expect(
    screen.queryByRole("button", { name: "删除记录" }),
  ).not.toBeInTheDocument();
  const more = screen.getByRole("button", { name: /更多操作/ });
  await userEvent.click(more);
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(more).toHaveFocus());
  await userEvent.click(more);
  await userEvent.click(screen.getByRole("menuitem", { name: "删除记录" }));
  expect(importService.action).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toHaveTextContent("CMS 中已有文章保留");
  await userEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "取消" }),
  );
  expect(importService.action).not.toHaveBeenCalled();
  await userEvent.click(more);
  await userEvent.click(screen.getByRole("menuitem", { name: "删除记录" }));
  await userEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() =>
    expect(importService.action).toHaveBeenCalledExactlyOnceWith(
      jobs[0].id,
      "delete",
    ),
  );
});

it.each(["confirmSubmitted", "confirmNotSubmitted"] as const)(
  "%s 必须核对后执行，不能自动重试",
  async (action) => {
    jobs = [job("submissionUnknown")];
    setup();
    await userEvent.click(
      await screen.findByRole("button", {
        name: action === "confirmSubmitted" ? "CMS 已添加" : "CMS 未添加",
      }),
    );
    expect(importService.action).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "确认核对结果" }));
    await waitFor(() =>
      expect(importService.action).toHaveBeenCalledExactlyOnceWith(
        jobs[0].id,
        action,
      ),
    );
  },
);

it("等待验证保留来源和继续操作，取消置于菜单，非终态不能删除", async () => {
  jobs = [job("waitingUser")];
  setup();
  await screen.findByRole("table");
  await userEvent.click(screen.getByRole("button", { name: "打开来源窗口" }));
  await waitFor(() =>
    expect(importService.action).toHaveBeenCalledWith(jobs[0].id, "show"),
  );
  await userEvent.click(screen.getByRole("button", { name: "验证完成，继续" }));
  await waitFor(() =>
    expect(importService.action).toHaveBeenCalledWith(jobs[0].id, "resume"),
  );
  expect(
    screen.queryByRole("button", { name: "取消" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
  expect(
    screen.queryByRole("menuitem", { name: "删除记录" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("menuitem", { name: "取消任务" }));
  await waitFor(() =>
    expect(importService.action).toHaveBeenCalledWith(jobs[0].id, "cancel"),
  );
});

it("选择来源标签页跟随实时任务更新，候选失效后阻止读取", async () => {
  jobs = [
    {
      ...job("waitingUser"),
      sourceInteraction: {
        kind: "selectTab",
        tabs: [
          {
            targetId: "demo-tab",
            title: "演示标签页",
            url: "https://baijiahao.baidu.com/s?id=1",
          },
        ],
      },
    },
  ];
  setup();
  await userEvent.click(
    await screen.findByRole("button", { name: "选择标签页" }),
  );
  await userEvent.click(screen.getByRole("radio", { name: "演示标签页" }));
  jobs = [{ ...jobs[0], sourceInteraction: { kind: "selectTab", tabs: [] } }];
  act(() => notify());
  await screen.findByText(/候选标签页均已失效/);
  expect(screen.getByRole("button", { name: "读取所选标签页" })).toBeDisabled();
  expect(importService.selectSourceTab).not.toHaveBeenCalled();
});

it("校验链接，入队期间阻止重复请求，失败保留输入及请求 ID", async () => {
  const pending = deferred<HarvestJob>();
  vi.mocked(importService.enqueue).mockReturnValueOnce(pending.promise);
  setup();
  await screen.findByRole("table");
  const field = screen.getByLabelText("文章链接");
  const form = field.closest("form")!;
  fireEvent.change(field, { target: { value: "not-a-url" } });
  fireEvent.submit(form);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "请输入有效的 HTTP 或 HTTPS 链接",
  );
  expect(importService.enqueue).not.toHaveBeenCalled();
  fireEvent.change(field, {
    target: { value: "https://baijiahao.baidu.com/s?id=99" },
  });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(importService.enqueue).toHaveBeenCalledTimes(1);
  expect(field).toBeDisabled();
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
  await waitFor(() => expect(field).toHaveValue(""));
});

it("选定有效标签页后才读取，不触发普通继续动作", async () => {
  jobs = [
    {
      ...job("waitingUser"),
      sourceMode: "cdp",
      sourceInteraction: {
        kind: "selectTab",
        tabs: [
          { targetId: "demo-source", title: "演示有效页面", url: jobs[0].url },
        ],
      },
    },
  ];
  setup();
  await userEvent.click(
    await screen.findByRole("button", { name: "选择标签页" }),
  );
  expect(screen.getByRole("button", { name: "读取所选标签页" })).toBeDisabled();
  await userEvent.click(screen.getByRole("radio", { name: "演示有效页面" }));
  await userEvent.click(screen.getByRole("button", { name: "读取所选标签页" }));
  await waitFor(() =>
    expect(importService.selectSourceTab).toHaveBeenCalledExactlyOnceWith(
      jobs[0].id,
      "demo-source",
    ),
  );
  expect(importService.action).not.toHaveBeenCalled();
});

it("动作请求未完成时锁定其他行，失败后保留记录并恢复操作", async () => {
  jobs = [job("failed"), job("waitingLogin", 2)];
  const pending = deferred<null>();
  vi.mocked(importService.action).mockReturnValueOnce(pending.promise);
  setup();
  await screen.findByRole("table");
  await userEvent.click(within(row(1)).getByRole("button", { name: "重试" }));
  expect(within(row(2)).getByRole("button", { name: "重试" })).toBeDisabled();
  expect(
    within(row(1)).getByRole("button", { name: /更多操作/ }),
  ).toBeDisabled();
  await act(async () => pending.reject(new Error("演示重试失败")));
  await waitFor(() =>
    expect(within(row(2)).getByRole("button", { name: "重试" })).toBeEnabled(),
  );
  expect(row(1)).toBeInTheDocument();
  expect(importService.action).toHaveBeenCalledTimes(1);
});

it("日期切换呈现空状态，刷新期间保留已有记录并锁定刷新按钮", async () => {
  setup();
  await screen.findByRole("table");
  const pending = deferred<Awaited<ReturnType<typeof importService.list>>>();
  vi.mocked(importService.list).mockReturnValueOnce(pending.promise);
  await userEvent.click(screen.getByRole("button", { name: "刷新采集记录" }));
  expect(screen.getByRole("button", { name: "刷新采集记录" })).toBeDisabled();
  expect(row(1)).toBeInTheDocument();
  await act(async () => pending.resolve({ jobs, maintenanceWarning: null }));
  jobs = [];
  fireEvent.change(screen.getByLabelText("采集日期"), {
    target: { value: "2026-10-01" },
  });
  await screen.findByText("该日期暂无采集记录");
  expect(importService.list).toHaveBeenLastCalledWith("2026-10-01");
});
