import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Provider } from "jotai";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { appQueryRuntime } from "@/lib/query-runtime";
import { authService } from "@/features/auth/service";
import { cmsIpc } from "@/services/tauri/cms";
import { articleIpc } from "@/services/tauri/articles";
import { articleService, articleInput } from "@/features/cms-articles/service";
import { articleMemory } from "@/features/cms-articles/state";
import { useArticleReview } from "@/features/cms-articles/use-article-review";
import * as articleLayout from "@/features/cms-articles/use-article-layout";
import Articles from "@/pages/Articles";
import * as platform from "@/lib/platform";
import { invoke } from "@tauri-apps/api/core";
import { ServiceError } from "@/services/tauri/client";
import type { ArticleView, ArticleReviewSummary } from "@/types/cms-article";
import { deferred, session } from "./cms-fixtures";
import { reviewArticle, reviewSummary } from "./article-review-fixtures";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));
function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={appQueryRuntime.client}>
      <Provider store={appQueryRuntime.store}>
        <TooltipProvider>{children}</TooltipProvider>
      </Provider>
    </QueryClientProvider>
  );
}
beforeEach(async () => {
  vi.restoreAllMocks();
  articleMemory.clear();
  authService.useLoginForm();
  vi.spyOn(cmsIpc, "login").mockResolvedValue(session);
  vi.spyOn(cmsIpc, "logout").mockResolvedValue({
    remoteSucceeded: true,
    credentialsCleared: true,
  });
  await authService.login({ username: "demo", password: "demo-only" });
  vi.spyOn(platform, "isAndroid").mockReturnValue(false);
  vi.spyOn(articleService, "classes").mockResolvedValue([
    { id: 1, name: "演示分类" },
  ]);
  vi.spyOn(articleService, "list").mockImplementation(async (query) => ({
    data: [reviewArticle(), reviewArticle(8102)],
    total: 51,
    current: query.current,
    pageSize: query.pagesize,
  }));
  vi.spyOn(articleService, "get").mockImplementation(async (id) =>
    reviewArticle(id),
  );
  vi.spyOn(articleService, "review").mockResolvedValue(reviewSummary());
  vi.spyOn(articleService, "reviewBatch").mockResolvedValue(
    reviewSummary([8101, 8102]),
  );
});
afterEach(() => articleMemory.clear());
function page(view: ArticleView = "review-1", current = 1) {
  const router = createMemoryRouter(
    [{ path: "/articles/:view", element: <Articles view={view} /> }],
    { initialEntries: [`/articles/${view}?current=${current}&pagesize=50`] },
  );
  render(
    <Wrapper>
      <RouterProvider router={router} />
    </Wrapper>,
  );
  return router;
}
const checkbox = () => screen.getByRole("checkbox", { name: "全选当前页文章" });
const expectSelected = (count: number) =>
  expect(screen.getByLabelText("已选文章数量")).toHaveTextContent(
    `已选 ${count} 篇`,
  );

it.each(["wide", "compact", "cards"] as const)(
  "%s 布局仅保留一个全选入口，半选、取消全选和批量审核焦点正常",
  async (layout) => {
    vi.spyOn(articleLayout, "useArticleLayout").mockReturnValue({
      ref: { current: null },
      layout,
    });
    page();
    await screen.findByRole("checkbox", { name: "选择文章 8101" });
    expect(
      screen.getAllByRole("checkbox", { name: "全选当前页文章" }),
    ).toHaveLength(1);
    const toolbar = screen.getByLabelText("批量审核工具栏");
    if (layout === "cards") {
      expect(within(toolbar).getByRole("checkbox")).toBe(checkbox());
      expect(screen.queryByRole("table")).toBeNull();
    } else {
      expect(checkbox().closest("table")).not.toBeNull();
      expect(within(toolbar).queryByRole("checkbox")).toBeNull();
      expect(toolbar.querySelector('[data-slot="separator"]')).toBeNull();
    }
    await userEvent.click(
      screen.getByRole("checkbox", { name: "选择文章 8101" }),
    );
    expect(checkbox()).toHaveAttribute("aria-checked", "mixed");
    expectSelected(1);
    await userEvent.click(checkbox());
    expectSelected(2);
    await userEvent.click(checkbox());
    expectSelected(0);
    await userEvent.click(checkbox());
    await userEvent.click(screen.getByRole("button", { name: "批量审核" }));
    await screen.findByRole("heading", { name: "批量审核" });
    expect(screen.getByLabelText("待审核文章").children).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "关闭审核" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "批量审核" })).toHaveFocus(),
    );
    await userEvent.click(screen.getByRole("button", { name: "清空选择" }));
    expectSelected(0);
  },
);

it("切换表格与卡片布局保留选择，原触发器卸载后关闭审核回到现有全选入口", async () => {
  type Layout = "wide" | "compact" | "cards";
  let changeLayout!: (layout: Layout) => void;
  vi.spyOn(articleLayout, "useArticleLayout").mockImplementation(
    function useTestArticleLayout() {
      const ref = useRef<HTMLDivElement>(null);
      const [layout, setLayout] = useState<Layout>("wide");
      changeLayout = setLayout;
      return { ref, layout };
    },
  );
  page();
  await screen.findByRole("checkbox", { name: "选择文章 8101" });
  await userEvent.click(
    screen.getByRole("checkbox", { name: "选择文章 8101" }),
  );
  for (const layout of ["compact", "cards"] as const) {
    act(() => changeLayout(layout));
    expectSelected(1);
    expect(
      screen.getAllByRole("checkbox", { name: "全选当前页文章" }),
    ).toHaveLength(1);
    expect(checkbox()).toHaveAttribute("aria-checked", "mixed");
    expect(
      screen.getByRole("checkbox", { name: "选择文章 8101" }),
    ).toBeChecked();
  }
  const trigger = screen.getAllByRole("button", { name: "审核" })[0];
  await userEvent.click(trigger);
  await screen.findByRole("article", { name: "审核正文预览" });
  act(() => changeLayout("wide"));
  expect(trigger.isConnected).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "关闭审核" }));
  await waitFor(() => expect(checkbox()).toHaveFocus());
  expectSelected(1);
});

it.each([false, true])(
  "两端三级页均提供审核与当前页勾选，优质文章和 editor 隐藏入口：Android=%s",
  async (android) => {
    vi.spyOn(platform, "isAndroid").mockReturnValue(android);
    for (const view of ["review-1", "review-2", "review-3"] as const) {
      const mounted = render(
        <Wrapper>
          <RouterProvider
            router={createMemoryRouter(
              [{ path: "/", element: <Articles view={view} /> }],
              { initialEntries: ["/?current=1&pagesize=50"] },
            )}
          />
        </Wrapper>,
      );
      await screen.findAllByRole("button", { name: "审核" });
      expect(
        screen.getAllByRole("checkbox", { name: "全选当前页文章" }),
      ).toHaveLength(1);
      expect(checkbox()).toBeVisible();
      mounted.unmount();
    }
    const mounted = render(
      <Wrapper>
        <RouterProvider
          router={createMemoryRouter(
            [{ path: "/", element: <Articles view="quality" /> }],
            { initialEntries: ["/?current=1"] },
          )}
        />
      </Wrapper>,
    );
    await screen.findAllByRole("button", { name: "编辑" });
    expect(screen.queryByRole("button", { name: "审核" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    mounted.unmount();
    vi.mocked(cmsIpc.login).mockResolvedValue({
      ...session,
      user: { ...session.user, roles: ["editor"] },
    });
    await authService.login({ username: "demo", password: "demo-only" });
    render(
      <Wrapper>
        <RouterProvider
          router={createMemoryRouter(
            [{ path: "/", element: <Articles view="review-1" /> }],
            { initialEntries: ["/?current=1"] },
          )}
        />
      </Wrapper>,
    );
    await screen.findAllByRole("button", { name: "编辑" });
    expect(screen.queryByRole("button", { name: "审核" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  },
);

it.each([false, true])(
  "当前页全选和清空，换页及刷新清空：Android=%s",
  async (android) => {
    vi.spyOn(platform, "isAndroid").mockReturnValue(android);
    page();
    await screen.findByRole("checkbox", { name: "全选当前页文章" });
    await userEvent.click(checkbox());
    expectSelected(2);
    await userEvent.click(screen.getByRole("button", { name: "清空选择" }));
    expectSelected(0);
    await userEvent.click(checkbox());
    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expectSelected(0));
    await waitFor(() => expect(checkbox()).toBeEnabled());
    await userEvent.click(checkbox());
    await userEvent.click(screen.getByRole("button", { name: "刷新文章列表" }));
    await waitFor(() => expectSelected(0));
  },
);

it("提交筛选清空选择，单条预览净化而提交保留 CMS 原文，同意二次确认且防重复提交", async () => {
  page();
  await screen.findByRole("checkbox", { name: "全选当前页文章" });
  await userEvent.click(checkbox());
  await userEvent.click(screen.getByRole("button", { name: "搜索" }));
  await waitFor(() => expectSelected(0));
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: "审核" })[0]).toBeEnabled(),
  );
  await userEvent.click(screen.getAllByRole("button", { name: "审核" })[0]);
  const preview = await screen.findByRole("article", { name: "审核正文预览" });
  expect(preview.querySelector("script")).toBeNull();
  expect(preview.querySelector("[onclick]")).toBeNull();
  expect(preview.querySelector('a[href^="javascript:"]')).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "同意" }));
  expect(articleService.review).not.toHaveBeenCalled();
  const pending = deferred<ArticleReviewSummary>();
  vi.mocked(articleService.review).mockReturnValue(pending.promise);
  fireEvent.click(screen.getByRole("button", { name: "确认同意" }));
  fireEvent.click(screen.getByRole("button", { name: "正在审核…" }));
  expect(articleService.review).toHaveBeenCalledTimes(1);
  expect(articleService.review).toHaveBeenCalledWith({
    view: "review-1",
    decision: "accept",
    comment: "",
    article: reviewArticle(),
  });
  expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  await act(async () => pending.resolve(reviewSummary()));
  expect(
    await screen.findByRole("heading", { name: "审核结果" }),
  ).toBeVisible();
  expect(screen.getByLabelText("逐篇审核结果")).toHaveTextContent("审核通过");
});

it.each([false, true])(
  "批量拒绝无需原因，确认后提交空 comment 并展示逐篇结果：Android=%s",
  async (android) => {
    vi.spyOn(platform, "isAndroid").mockReturnValue(android);
    page();
    await screen.findByRole("checkbox", { name: "全选当前页文章" });
    await userEvent.click(checkbox());
    await userEvent.click(screen.getByRole("button", { name: "批量审核" }));
    expect(
      await screen.findByRole("heading", { name: "批量审核" }),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "关闭审核" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "批量审核" })).toHaveFocus(),
    );
    await userEvent.click(screen.getByRole("button", { name: "批量审核" }));
    await userEvent.click(screen.getByRole("button", { name: "拒绝" }));
    const confirm = screen.getByRole("dialog", { name: "确认拒绝稿件？" });
    expect(within(confirm).queryByRole("textbox")).toBeNull();
    expect(
      within(confirm).getByText("本次处理 2 篇文章。提交后不会自动重试。"),
    ).toBeVisible();
    expect(articleService.reviewBatch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "确认拒绝" }));
    await screen.findByRole("heading", { name: "审核结果" });
    expect(articleService.reviewBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "reject",
        comment: "",
        articles: [reviewArticle(), reviewArticle(8102)],
      }),
    );
    expect(
      within(screen.getByLabelText("逐篇审核结果")).getAllByRole("listitem"),
    ).toHaveLength(2);
  },
);

it.each([false, true])(
  "单条拒绝没有原因输入，取消不提交，再确认发送空 comment：Android=%s",
  async (android) => {
    vi.spyOn(platform, "isAndroid").mockReturnValue(android);
    page();
    await userEvent.click(
      (await screen.findAllByRole("button", { name: "审核" }))[0],
    );
    await screen.findByRole("article", { name: "审核正文预览" });
    await userEvent.click(screen.getByRole("button", { name: "拒绝" }));
    const confirmation = screen.getByRole("dialog", { name: "确认拒绝稿件？" });
    expect(within(confirmation).queryByRole("textbox")).toBeNull();
    await userEvent.click(
      within(confirmation).getByRole("button", { name: "取消" }),
    );
    expect(articleService.review).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "拒绝" })).toHaveFocus(),
    );
    await userEvent.click(screen.getByRole("button", { name: "拒绝" }));
    await userEvent.click(screen.getByRole("button", { name: "确认拒绝" }));
    await screen.findByRole("heading", { name: "审核结果" });
    expect(articleService.review).toHaveBeenCalledWith({
      view: "review-1",
      decision: "reject",
      comment: "",
      article: reviewArticle(),
    });
  },
);

it("未保存文章和转素材草稿阻挡批量审核，放弃需再次确认，继续编辑有入口", async () => {
  vi.spyOn(platform, "isAndroid").mockReturnValue(true);
  const base = reviewArticle();
  articleMemory.saveEdit("review-2", {
    kind: "edit",
    base,
    input: { ...articleInput(base), title: "未保存演示" },
  });
  page();
  await screen.findByRole("checkbox", { name: "全选当前页文章" });
  await userEvent.click(checkbox());
  await userEvent.click(screen.getByRole("button", { name: "批量审核" }));
  expect(
    await screen.findByRole("heading", { name: "请先处理未保存草稿" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "继续编辑草稿" })).toBeVisible();
  expect(articleService.get).not.toHaveBeenCalled();
  expect(articleService.reviewBatch).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "放弃草稿" }));
  expect(articleMemory.edit("review-2")).not.toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "确认放弃草稿" }));
  expect(articleMemory.edit("review-2")).toBeNull();
  articleMemory.saveEdit("review-3", {
    kind: "promote",
    article: base,
    input: {
      channel: "demo",
      subChannel: null,
      publishDate: null,
      url: null,
      title: "演示",
      titlePic: "",
      titlePic2: null,
      smallText: null,
      writer: null,
    },
  });
  await userEvent.click(screen.getByRole("button", { name: "批量审核" }));
  expect(
    await screen.findByRole("heading", { name: "请先处理未保存草稿" }),
  ).toBeVisible();
});

it.each([false, true])(
  "审核后刷新并恢复越界分页：Android=%s",
  async (android) => {
    vi.spyOn(platform, "isAndroid").mockReturnValue(android);
    let reviewed = false;
    vi.mocked(articleService.list).mockImplementation(async (q) => ({
      data: reviewed && q.current === 2 ? [] : [reviewArticle()],
      total: reviewed ? 1 : 51,
      current: q.current,
      pageSize: q.pagesize,
    }));
    vi.mocked(articleService.review).mockImplementation(async () => {
      reviewed = true;
      return reviewSummary();
    });
    const router = page("review-1", 2);
    await userEvent.click(
      (await screen.findAllByRole("button", { name: "审核" }))[0],
    );
    await screen.findByRole("article", { name: "审核正文预览" });
    await userEvent.click(screen.getByRole("button", { name: "同意" }));
    await userEvent.click(screen.getByRole("button", { name: "确认同意" }));
    await screen.findByRole("heading", { name: "审核结果" });
    await waitFor(() =>
      expect(router.state.location.search).toContain("current=1"),
    );
  },
);

it("认证失效前保留逐篇摘要，同账号重新登录保留、换号或退出清除", async () => {
  const value = reviewSummary();
  value.authExpired = true;
  value.items[0].status = "failed";
  value.items[0].code = "AUTH_EXPIRED";
  vi.mocked(articleService.reviewBatch).mockResolvedValue(value);
  const { result } = renderHook(() => useArticleReview("review-1"), {
    wrapper: Wrapper,
  });
  await act(async () => result.current.begin([reviewArticle()], false));
  act(() => result.current.setDecision("accept"));
  await act(async () => result.current.submit());
  expect(authService.getSnapshot().status).toBe("anonymous");
  expect(articleMemory.reviewResult("review-1")).toEqual(value);
  await act(async () =>
    authService.login({ username: "demo", password: "demo-only" }),
  );
  expect(articleMemory.reviewResult("review-1")).toEqual(value);
  vi.mocked(cmsIpc.login).mockResolvedValue({
    ...session,
    user: { ...session.user, userId: 7 },
  });
  await act(async () =>
    authService.login({ username: "other", password: "demo-only" }),
  );
  expect(articleMemory.reviewResult("review-1")).toBeNull();
  articleMemory.saveReviewResult("review-1", value);
  await act(async () => authService.logout());
  expect(articleMemory.reviewResult("review-1")).toBeNull();
});

it("不明确结果需显式刷新核对，且 IPC 仅使用两个专用类型化审核命令", async () => {
  vi.mocked(invoke).mockResolvedValue(reviewSummary());
  await articleIpc.review({
    view: "review-1",
    decision: "accept",
    comment: "",
    article: reviewArticle(),
  });
  await articleIpc.reviewBatch({
    view: "review-3",
    decision: "reject",
    comment: "演示",
    articles: [reviewArticle()],
  });
  expect(invoke).toHaveBeenCalledWith("cms_review_article", expect.any(Object));
  expect(invoke).toHaveBeenCalledWith(
    "cms_review_articles",
    expect.any(Object),
  );
  const value = reviewSummary();
  value.items[0].status = "unconfirmed";
  articleMemory.saveReviewResult("review-1", value);
  const { result } = renderHook(() => useArticleReview("review-1"), {
    wrapper: Wrapper,
  });
  act(() => result.current.closeResults());
  await act(async () => result.current.begin([reviewArticle()], true));
  expect(result.current.target).toBeNull();
  expect(result.current.resultOpen).toBe(true);
  articleMemory.confirmReviewRefresh("review-1");
  act(() => result.current.closeResults());
  await act(async () => result.current.begin([reviewArticle()], true));
  expect(result.current.target?.detail).toEqual(reviewArticle());
});

it("IPC 未返回完整结果时保存待确认摘要，不提供直接重试", async () => {
  vi.mocked(articleService.reviewBatch).mockRejectedValue(
    new ServiceError("IPC_ERROR", "演示中断"),
  );
  const { result } = renderHook(() => useArticleReview("review-1"), {
    wrapper: Wrapper,
  });
  await act(async () => result.current.begin([reviewArticle()], false));
  act(() => result.current.setDecision("accept"));
  await act(async () => result.current.submit());
  expect(result.current.target).toBeNull();
  expect(result.current.summary?.items[0]).toMatchObject({
    status: "unconfirmed",
    code: "IPC_RESULT_UNCONFIRMED",
  });
  act(() => result.current.closeResults());
  await act(async () => result.current.begin([reviewArticle()], false));
  expect(result.current.target).toBeNull();
  expect(articleService.reviewBatch).toHaveBeenCalledTimes(1);
});

it("换号后收到旧批次响应不会把旧账号摘要恢复到新账号", async () => {
  const pending = deferred<ArticleReviewSummary>();
  vi.mocked(articleService.reviewBatch).mockReturnValue(pending.promise);
  const { result } = renderHook(() => useArticleReview("review-1"), {
    wrapper: Wrapper,
  });
  await act(async () => result.current.begin([reviewArticle()], false));
  act(() => result.current.setDecision("accept"));
  let submission!: Promise<void>;
  act(() => {
    submission = result.current.submit();
  });
  vi.mocked(cmsIpc.login).mockResolvedValue({
    ...session,
    user: { ...session.user, userId: 7 },
  });
  await act(async () =>
    authService.login({ username: "other", password: "demo-only" }),
  );
  await act(async () => {
    pending.resolve(reviewSummary());
    await submission;
  });
  expect(result.current.target).toBeNull();
  expect(result.current.summary).toBeNull();
  expect(articleMemory.reviewResult("review-1")).toBeNull();
});
