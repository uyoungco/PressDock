import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppProviders } from "@/app/providers";
import Dashboard from "@/pages/Dashboard";
import { importService } from "@/features/import/service";
import { articleService } from "@/features/cms-articles/service";
import {
  localCollectionDate,
  type HarvestJob,
} from "@/features/import/contracts";
import {
  createQueryRuntime,
  harvestDateAtom,
  articleFiltersAtom,
  retainQueryUser,
} from "@/lib/query-runtime";
import { isDemo } from "@/lib/platform";
import { summarizeHarvest } from "@/features/dashboard/model";
import { deferred } from "./cms-fixtures";

const account = vi.hoisted(() => ({ user: 7 }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    status: "authenticated",
    session: { user: { userId: account.user } },
  }),
}));
vi.mock("@/lib/platform", async (original) => ({
  ...(await original<typeof import("@/lib/platform")>()),
  isDemo: vi.fn(() => false),
}));
vi.mock("@/features/import/service", () => ({
  importService: { list: vi.fn(), subscribe: vi.fn(), openSource: vi.fn() },
}));
vi.mock("@/features/cms-articles/service", async (original) => ({
  ...(await original<typeof import("@/features/cms-articles/service")>()),
  articleService: { list: vi.fn() },
}));

let notify: () => void;
beforeEach(() => {
  vi.clearAllMocks();
  account.user = 7;
  vi.mocked(isDemo).mockReturnValue(false);
  vi.mocked(importService.subscribe).mockImplementation(async (listener) => {
    notify = listener;
    return () => undefined;
  });
  vi.mocked(importService.list).mockResolvedValue({
    jobs: [],
    maintenanceWarning: null,
  });
  vi.mocked(importService.openSource).mockResolvedValue(null);
  vi.mocked(articleService.list).mockImplementation(async (query) => ({
    data: [],
    total: { "review-1": 125, "review-2": 42, "review-3": 8, quality: 0 }[
      query.view
    ],
    current: query.current,
    pageSize: query.pagesize,
  }));
});

function job(
  status: HarvestJob["status"],
  index = 1,
  extra: Partial<HarvestJob> = {},
): HarvestJob {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    url: `https://example.com/${index}`,
    title: `真实采集 ${index}`,
    collectionDate: localCollectionDate(),
    status,
    sourceMode: "webview",
    sourceInteraction: null,
    developerMode: false,
    stage: null,
    warnings: [],
    error: null,
    attempts: 1,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    updatedAt: new Date(Date.now() + index * 1000).toISOString(),
    cmsArticleId: null,
    ...extra,
  };
}

function setup() {
  const runtime = createQueryRuntime();
  const router = createMemoryRouter(
    [
      { path: "/dashboard", element: <Dashboard /> },
      { path: "/import", element: <p>采集目标页</p> },
      { path: "/articles/:view", element: <p>文章目标页</p> },
      { path: "/away", element: <p>其他页面</p> },
    ],
    { initialEntries: ["/dashboard"] },
  );
  const view = render(
    <AppProviders runtime={runtime}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...view, runtime, router };
}

describe("真实业务工作台", () => {
  it("统计正式任务、排除调试，不将取消或提交未知计为成功；最近记录排序并限制五条", () => {
    const jobs = [
      "queued",
      "running",
      "waitingUser",
      "waitingLogin",
      "succeeded",
      "failed",
      "interrupted",
      "submissionUnknown",
      "cancelled",
      "debugCompleted",
    ].map((status, index) => job(status as HarvestJob["status"], index));
    jobs.push(job("succeeded", 11, { developerMode: true }));
    const stats = summarizeHarvest(jobs);
    expect(stats).toMatchObject({
      today: 9,
      active: 2,
      attention: 5,
      succeeded: 1,
    });
    expect(stats.recent.map((record) => record.status)).toEqual([
      "cancelled",
      "submissionUnknown",
      "interrupted",
      "failed",
      "succeeded",
    ]);
    expect(jobs[0].status).toBe("queued");
  });

  it("使用 CMS total 而非当前页条数，显示真实记录并通过服务打开来源", async () => {
    vi.mocked(importService.list).mockResolvedValue({
      jobs: [job("succeeded")],
      maintenanceWarning: null,
    });
    const { router } = setup();
    expect(await screen.findByText("真实采集 1")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(screen.getByRole("group", { name: "CMS 待审核" })).getByText(
          "175",
        ),
      ).toBeInTheDocument(),
    );
    expect(
      within(screen.getByRole("group", { name: "今日采集" })).getByText("1"),
    ).toBeInTheDocument();
    expect(screen.getByText("已添加 CMS 1 条")).toBeInTheDocument();
    expect(articleService.list).toHaveBeenCalledTimes(3);
    for (const [query] of vi.mocked(articleService.list).mock.calls)
      expect(query).toMatchObject({
        current: 1,
        pagesize: 10,
        title: "",
        start: "",
        end: "",
      });
    fireEvent.click(screen.getByRole("link", { name: "真实采集 1" }));
    expect(importService.openSource).toHaveBeenCalledWith(
      "https://example.com/1",
    );
    expect(screen.queryByText("演示工作区")).not.toBeInTheDocument();
    router.dispose();
  });

  it("三级中一项首次失败时不展示部分合计，其他区域继续显示并可单独重试", async () => {
    vi.mocked(articleService.list).mockImplementation(async (query) => {
      if (query.view === "review-2") throw new Error("没有二级查询权限");
      return { data: [], total: 9, current: 1, pageSize: 10 };
    });
    const { router } = setup();
    expect(await screen.findByText("今天暂无正式采集记录")).toBeInTheDocument();
    expect(
      await screen.findByText("二级：没有二级查询权限"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "CMS 待审核" })).getByRole(
        "paragraph",
      ),
    ).toHaveTextContent(/^—$/);
    vi.mocked(articleService.list).mockResolvedValueOnce({
      data: [],
      total: 12,
      current: 1,
      pageSize: 10,
    });
    fireEvent.click(screen.getByRole("button", { name: "重试CMS 待审核" }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("group", { name: "CMS 待审核" })).getByText(
          "30",
        ),
      ).toBeInTheDocument(),
    );
    expect(articleService.list).toHaveBeenCalledTimes(4);
    router.dispose();
  });

  it("手动刷新失败保留记录与统计，通知刷新复用查询，离开返回命中缓存", async () => {
    vi.mocked(importService.list).mockResolvedValue({
      jobs: [job("queued")],
      maintenanceWarning: null,
    });
    const { router } = setup();
    await screen.findByText("真实采集 1");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "刷新工作台" })).toBeEnabled(),
    );
    await act(() => router.navigate("/away"));
    await act(() => router.navigate("/dashboard"));
    expect(importService.list).toHaveBeenCalledTimes(1);
    expect(articleService.list).toHaveBeenCalledTimes(3);
    vi.mocked(importService.list).mockRejectedValueOnce(new Error("暂时离线"));
    vi.mocked(articleService.list).mockRejectedValueOnce(
      new Error("CMS 暂时离线"),
    );
    fireEvent.click(screen.getByRole("button", { name: "刷新工作台" }));
    expect(
      await screen.findByText("采集记录刷新失败，保留上次数据"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("CMS 待审核刷新失败，保留上次数据"),
    ).toBeInTheDocument();
    expect(screen.getByText("真实采集 1")).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "CMS 待审核" })).getByText(
        "175",
      ),
    ).toBeInTheDocument();
    vi.mocked(importService.list).mockResolvedValue({
      jobs: [job("succeeded")],
      maintenanceWarning: null,
    });
    await act(async () => notify());
    await screen.findByText("已添加 CMS 1 条");
    expect(importService.list).toHaveBeenCalledTimes(3);
    router.dispose();
  });

  it("采集入口定位今天，审核入口显式清空历史筛选", async () => {
    const { router, runtime } = setup();
    await screen.findByText("今天暂无正式采集记录");
    runtime.store.set(harvestDateAtom, {
      date: "2026-01-01",
      today: localCollectionDate(),
    });
    fireEvent.click(screen.getByRole("link", { name: "全部采集记录" }));
    expect(runtime.store.get(harvestDateAtom)?.date).toBe(
      localCollectionDate(),
    );
    await act(() => router.navigate("/dashboard"));
    runtime.store.set(articleFiltersAtom, {
      "review-2": {
        view: "review-2",
        id: null,
        classid: null,
        title: "旧条件",
        author: "",
        editor: false,
        nubia: false,
        start: "",
        end: "",
        current: 4,
        pagesize: 100,
      },
    });
    fireEvent.click(screen.getByRole("link", { name: "二级待审核 42 篇" }));
    expect(router.state.location.pathname).toBe("/articles/review-2");
    expect(
      new URLSearchParams(router.state.location.search).get("current"),
    ).toBe("1");
    expect(new URLSearchParams(router.state.location.search).has("title")).toBe(
      false,
    );
    router.dispose();
  });

  it("跨日切换当天查询，不覆盖采集页历史日期", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(2026, 10, 10, 23, 59, 50));
    const pending = deferred<Awaited<ReturnType<typeof importService.list>>>();
    vi.mocked(importService.list).mockReturnValueOnce(pending.promise);
    const { router, runtime } = setup();
    try {
      await act(async () => {
        await Promise.resolve();
      });
      runtime.store.set(harvestDateAtom, {
        date: "2026-01-01",
        today: "2026-11-10",
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(importService.list).toHaveBeenLastCalledWith("2026-11-11");
      expect(runtime.store.get(harvestDateAtom)?.date).toBe("2026-01-01");
      await act(async () => {
        pending.resolve({
          jobs: [job("failed", 99)],
          maintenanceWarning: null,
        });
      });
      expect(screen.queryByText("真实采集 99")).not.toBeInTheDocument();
    } finally {
      router.dispose();
      vi.useRealTimers();
    }
  });

  it("切换账号后，旧账号尚未完成的请求不会回填新工作台", async () => {
    const pending = deferred<Awaited<ReturnType<typeof importService.list>>>();
    vi.mocked(importService.list).mockReturnValueOnce(pending.promise);
    const { router, runtime, rerender } = setup();
    runtime.owner = 7;
    await waitFor(() => expect(importService.list).toHaveBeenCalledTimes(1));
    await act(() => router.navigate("/away"));
    account.user = 8;
    act(() => retainQueryUser(8));
    rerender(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    await act(() => router.navigate("/dashboard"));
    await screen.findByText("今天暂无正式采集记录");
    await act(async () =>
      pending.resolve({ jobs: [job("failed", 99)], maintenanceWarning: null }),
    );
    expect(screen.queryByText("真实采集 99")).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "今日采集" })).getByText("0"),
    ).toBeInTheDocument();
    router.dispose();
  });

  it("演示构建标明模式，不请求真实概览接口", async () => {
    vi.mocked(isDemo).mockReturnValue(true);
    const { router } = setup();
    expect(screen.getByText("演示模式 · Mock 数据")).toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
    expect(importService.list).not.toHaveBeenCalled();
    expect(articleService.list).not.toHaveBeenCalled();
    router.dispose();
  });
});
