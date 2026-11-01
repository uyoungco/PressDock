import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { AppProviders } from "@/app/providers";
import {
  createQueryRuntime,
  businessKeys,
  channelFilterAtom,
  articleFiltersAtom,
  harvestDateAtom,
  invalidateBusinessQueries,
  retainQueryUser,
  clearBusinessQueries,
  suspendBusinessQueries,
} from "@/lib/query-runtime";
import { useArticles } from "@/hooks/use-articles";
import { articleService as localArticleService } from "@/services/cms";
import { articleService, defaultQuery } from "@/features/cms-articles/service";
import { channelService } from "@/features/channels/service";
import { importService } from "@/features/import/service";
import { localCollectionDate } from "@/features/import/contracts";
import Articles from "@/pages/Articles";
import Channels from "@/pages/Channels";
import ImportPage from "@/pages/Import";
import { deferred, materialPage } from "./cms-fixtures";
import type { ArticleView } from "@/types/cms-article";
import { articleSchema } from "@/types/article";
import demoArticles from "@/features/articles/demo-articles.json";

const account = vi.hoisted(() => ({ user: 7 }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    status: "authenticated",
    session: { user: { userId: account.user } },
  }),
}));
vi.mock("@/features/import/service", () => ({
  importService: {
    subscribe: vi.fn(),
    list: vi.fn(),
    action: vi.fn(),
    enqueue: vi.fn(),
  },
}));
vi.mock("@/services/cms", () => ({ articleService: { getArticles: vi.fn() } }));
vi.mock("@/features/channels/service", async (original) => ({
  ...(await original<typeof import("@/features/channels/service")>()),
  channelService: { groups: vi.fn(), list: vi.fn() },
}));
vi.mock("@/features/cms-articles/service", async (original) => {
  const actual =
    await original<typeof import("@/features/cms-articles/service")>();
  return {
    ...actual,
    articleService: {
      ...actual.articleService,
      classes: vi.fn(),
      list: vi.fn(),
    },
  };
});
vi.mock("@/features/channels/MaterialImage", () => ({
  MaterialImage: () => null,
}));

let notify: () => void;
beforeEach(() => {
  vi.clearAllMocks();
  account.user = 7;
  vi.mocked(importService.subscribe).mockImplementation(async (listener) => {
    notify = listener;
    return vi.fn<() => void>();
  });
  vi.mocked(importService.list).mockResolvedValue({
    jobs: [],
    maintenanceWarning: null,
  });
  vi.mocked(channelService.groups).mockResolvedValue([]);
  vi.mocked(channelService.list).mockImplementation(async (query) =>
    materialPage(10, query.current, query.pagesize),
  );
  vi.mocked(articleService.classes).mockResolvedValue([]);
  vi.mocked(articleService.list).mockImplementation(async (query) => ({
    data: [],
    total: 100,
    current: query.current,
    pageSize: query.pagesize,
  }));
  vi.mocked(localArticleService.getArticles).mockResolvedValue([]);
});

function LocalList() {
  const { articles, loading, error, refresh } = useArticles();
  return (
    <>
      <p>{loading ? "读取中" : `本地列表 ${articles.length}`}</p>
      {error && <p role="alert">{error}</p>}
      <button onClick={refresh}>刷新本地列表</button>
    </>
  );
}
function setup(path: string) {
  const runtime = createQueryRuntime();
  const router = createMemoryRouter(
    [
      { path: "/channels", element: <Channels /> },
      ...(["quality", "review-1", "review-2", "review-3"] as ArticleView[]).map(
        (view) => ({
          path: `/articles/${view}`,
          element: <Articles view={view} />,
        }),
      ),
      { path: "/import", element: <ImportPage /> },
      { path: "/local-1", element: <LocalList /> },
      { path: "/local-2", element: <LocalList /> },
      { path: "/away", element: <p>其他页面</p> },
    ],
    { initialEntries: [path] },
  );
  const rendered = render(
    <AppProviders runtime={runtime}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { runtime, router, ...rendered };
}

describe("业务列表缓存", () => {
  it("工作台和发布使用的本地文章查询在页面间复用，刷新失败保留数据", async () => {
    vi.mocked(localArticleService.getArticles).mockResolvedValueOnce([
      articleSchema.parse(demoArticles[0]),
    ]);
    const { router } = setup("/local-1");
    await screen.findByText("本地列表 1");
    await act(() => router.navigate("/away"));
    await act(() => router.navigate("/local-2"));
    expect(screen.getByText("本地列表 1")).toBeInTheDocument();
    expect(localArticleService.getArticles).toHaveBeenCalledTimes(1);
    vi.mocked(localArticleService.getArticles).mockRejectedValueOnce(
      new Error("暂时离线"),
    );
    fireEvent.click(screen.getByText("刷新本地列表"));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时离线");
    expect(screen.getByText("本地列表 1")).toBeInTheDocument();
    router.dispose();
  });

  it("缓存超过五分钟仍保留，聚焦和网络恢复不发起请求", async () => {
    const { router, runtime } = setup("/local-1");
    await screen.findByText("本地列表 0");
    await act(() => router.navigate("/away"));
    vi.useFakeTimers();
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(360_000);
      });
      expect(
        runtime.client.getQueryData(businessKeys.localArticles(7)),
      ).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
    await act(() => router.navigate("/local-1"));
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    expect(localArticleService.getArticles).toHaveBeenCalledTimes(1);
    focusManager.setFocused(undefined);
    router.dispose();
  });

  it("渠道分页往返直接命中缓存，显式刷新只更新当前页", async () => {
    const { router } = setup("/channels?pagesize=10");
    await screen.findByText("渠道新闻 10");
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(channelService.list).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "上一页" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    await waitFor(() =>
      expect(router.state.location.search).toContain("current=1"),
    );
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() =>
      expect(router.state.location.search).toContain("current=2"),
    );
    expect(channelService.list).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "刷新渠道素材" }));
    await waitFor(() => expect(channelService.list).toHaveBeenCalledTimes(3));
    expect(channelService.groups).toHaveBeenCalledTimes(1);
    router.dispose();
  });

  it("四类文章独立恢复已提交查询，共享分类缓存", async () => {
    const { router, runtime } = setup(
      "/articles/quality?title=优质&current=2&pagesize=20",
    );
    await waitFor(() => expect(articleService.list).toHaveBeenCalledTimes(1));
    for (const view of ["review-1", "review-2", "review-3"]) {
      await act(() => router.navigate(`/articles/${view}`));
    }
    await waitFor(() => expect(articleService.list).toHaveBeenCalledTimes(4));
    await act(() => router.navigate("/articles/quality"));
    expect(screen.getByLabelText("标题", { selector: "input" })).toHaveValue(
      "优质",
    );
    expect(runtime.store.get(articleFiltersAtom).quality?.current).toBe(2);
    expect(articleService.list).toHaveBeenCalledTimes(4);
    expect(articleService.classes).toHaveBeenCalledTimes(1);
    router.dispose();
  });

  it("后台事件在离开列表后仍失效缓存，返回时读取新快照", async () => {
    const { router } = setup("/articles/quality");
    await waitFor(() => expect(articleService.list).toHaveBeenCalledTimes(1));
    await act(() => router.navigate("/away"));
    await act(async () => notify());
    expect(articleService.list).toHaveBeenCalledTimes(1);
    await act(() => router.navigate("/articles/quality"));
    await waitFor(() => expect(articleService.list).toHaveBeenCalledTimes(2));
    router.dispose();
  });

  it("采集日期和快照在返回时恢复，事件通知与写后刷新合并", async () => {
    const { router, runtime } = setup("/import");
    await waitFor(() => expect(importService.list).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("采集日期"), {
      target: { value: "2026-10-01" },
    });
    await waitFor(() => expect(importService.list).toHaveBeenCalledTimes(2));
    await act(() => router.navigate("/away"));
    await act(() => router.navigate("/import"));
    expect(screen.getByLabelText("采集日期")).toHaveValue("2026-10-01");
    expect(importService.list).toHaveBeenCalledTimes(2);
    await act(async () => {
      notify();
      notify();
      await invalidateBusinessQueries(runtime.client, businessKeys.harvest(7));
    });
    expect(importService.list).toHaveBeenCalledTimes(3);
    router.dispose();
  });

  it("刷新期间发生多次采集变化，串行补读一次并保留最新快照", async () => {
    const { router } = setup("/import");
    await waitFor(() => expect(importService.list).toHaveBeenCalledTimes(1));
    const pending = deferred<Awaited<ReturnType<typeof importService.list>>>();
    vi.mocked(importService.list)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ jobs: [], maintenanceWarning: "最新快照" });
    await act(async () => notify());
    await waitFor(() => expect(importService.list).toHaveBeenCalledTimes(2));
    await act(async () => {
      notify();
      notify();
    });
    expect(importService.list).toHaveBeenCalledTimes(2);
    await act(async () =>
      pending.resolve({ jobs: [], maintenanceWarning: "较旧快照" }),
    );
    await screen.findByText(/最新快照/);
    expect(importService.list).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(/较旧快照/)).not.toBeInTheDocument();
    router.dispose();
  });

  it("当天视图在离开页面跨日后跟随今天，历史日期不跳转", async () => {
    const { router, runtime } = setup("/import");
    await waitFor(() => expect(importService.list).toHaveBeenCalledTimes(1));
    await act(() => router.navigate("/away"));
    const today = localCollectionDate();
    runtime.store.set(harvestDateAtom, {
      date: "2000-01-01",
      today: "2000-01-01",
    });
    await act(() => router.navigate("/import"));
    expect(screen.getByLabelText("采集日期")).toHaveValue(today);
    await act(() => router.navigate("/away"));
    runtime.store.set(harvestDateAtom, {
      date: "2000-01-01",
      today: "2000-01-02",
    });
    await act(() => router.navigate("/import"));
    expect(screen.getByLabelText("采集日期")).toHaveValue("2000-01-01");
    router.dispose();
  });

  it("暂停后保留筛选，换号或显式退出清空缓存，旧响应无法回填", async () => {
    const pending =
      deferred<Awaited<ReturnType<typeof localArticleService.getArticles>>>();
    vi.mocked(localArticleService.getArticles).mockReturnValueOnce(
      pending.promise,
    );
    const { router, runtime } = setup("/local-1");
    await waitFor(() =>
      expect(localArticleService.getArticles).toHaveBeenCalledTimes(1),
    );
    runtime.store.set(articleFiltersAtom, { quality: defaultQuery("quality") });
    runtime.store.set(channelFilterAtom, {
      channel: "A",
      subchannel: "",
      publishdate: "",
      current: 1,
      pagesize: 30,
    });
    await act(async () => {
      retainQueryUser(7);
      suspendBusinessQueries();
    });
    await act(async () => {
      await invalidateBusinessQueries(
        runtime.client,
        businessKeys.localArticles(7),
      );
    });
    expect(localArticleService.getArticles).toHaveBeenCalledTimes(1);
    expect(runtime.store.get(channelFilterAtom)?.channel).toBe("A");
    await act(() => router.navigate("/away"));
    await act(async () => {
      account.user = 8;
      retainQueryUser(8);
    });
    expect(runtime.store.get(channelFilterAtom)).toBeNull();
    expect(runtime.store.get(articleFiltersAtom)).toEqual({});
    await act(async () => pending.resolve([]));
    expect(
      runtime.client.getQueryData(businessKeys.localArticles(7)),
    ).toBeUndefined();
    await act(() => router.navigate("/local-2"));
    await screen.findByText("本地列表 0");
    expect(runtime.client.getQueryData(businessKeys.localArticles(8))).toEqual(
      [],
    );
    await act(() => router.navigate("/away"));
    await act(async () => clearBusinessQueries());
    expect(runtime.client.getQueryCache().getAll()).toHaveLength(0);
    router.dispose();
  });
});
