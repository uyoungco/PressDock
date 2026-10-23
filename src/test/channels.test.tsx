import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import Channels from "@/pages/Channels";
import { channelService, readChannelQuery } from "@/features/channels/service";
import { AppProviders } from "@/app/providers";
import { deferred, material, materialPage } from "./cms-fixtures";
import type { PromotePage } from "@/types/cms";
import { channelQueryMemory } from "@/features/channels/query-memory";
import { promoteImages } from "@/features/channels/images";

vi.mock("@/features/channels/images", () => ({
  promoteImages: { acquire: vi.fn() },
  imageByteSize: (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`,
}));

vi.mock("@/features/channels/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/channels/service")>()),
  channelService: { groups: vi.fn(), list: vi.fn() },
}));
beforeEach(() => {
  vi.clearAllMocks();
  channelQueryMemory.clear();
  vi.mocked(channelService.groups).mockResolvedValue([
    { channel: "KOOK", subchannels: ["轮播图"] },
    { channel: "2345", subchannels: ["头条图"] },
  ]);
  vi.mocked(channelService.list).mockImplementation(async (q) =>
    materialPage(1, q.current, q.pagesize, 175016),
  );
});
function setup(path = "/channels") {
  const router = createMemoryRouter(
    [
      { path: "/channels", element: <Channels /> },
      { path: "/elsewhere", element: <p>其他页面</p> },
    ],
    { initialEntries: [path] },
  );
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}
describe("渠道素材筛选、分页和详情", () => {
  it("初始并行取数，选择条件不查询，搜索才提交并回到第一页", async () => {
    const router = setup("/channels?current=2&pagesize=10");
    await screen.findByText("渠道新闻 1");
    await userEvent.selectOptions(
      screen.getByLabelText("渠道", { exact: true }),
      "KOOK",
    );
    await userEvent.selectOptions(
      screen.getByLabelText("子渠道", { exact: true }),
      "轮播图",
    );
    await userEvent.type(screen.getByLabelText("发布日期"), "2026-10-23");
    expect(channelService.list).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() =>
      expect(channelService.list).toHaveBeenLastCalledWith({
        channel: "KOOK",
        subchannel: "轮播图",
        publishdate: "2026-10-23",
        current: 1,
        pagesize: 10,
      }),
    );
    expect(
      new URLSearchParams(router.state.location.search).get("publishdate"),
    ).toBe("2026-10-23");
    await userEvent.selectOptions(
      screen.getByLabelText("渠道", { exact: true }),
      "2345",
    );
    expect(screen.getByLabelText("子渠道", { exact: true })).toHaveValue("");
    expect(channelService.groups).toHaveBeenCalledTimes(1);
    router.dispose();
  });
  it("重置清空日期和两级渠道，并保留每页条数", async () => {
    const router = setup(
      "/channels?channel=KOOK&subchannel=轮播图&publishdate=2026-10-23&current=2&pagesize=10",
    );
    await screen.findByText("渠道新闻 1");
    await userEvent.click(screen.getByRole("button", { name: "重置" }));
    await waitFor(() =>
      expect(channelService.list).toHaveBeenLastCalledWith({
        channel: "",
        subchannel: "",
        publishdate: "",
        current: 1,
        pagesize: 10,
      }),
    );
    expect(screen.getByLabelText("发布日期")).toHaveValue("");
    expect(screen.getByLabelText("渠道", { exact: true })).toHaveValue("");
    expect(screen.getByLabelText("子渠道", { exact: true })).toHaveValue("");
    router.dispose();
  });
  it("每页条数变化回到第一页，保留已提交条件", async () => {
    const router = setup("/channels?channel=KOOK&current=2&pagesize=30");
    await screen.findByText("渠道新闻 1");
    await userEvent.selectOptions(screen.getByLabelText("每页条数"), "50");
    await waitFor(() =>
      expect(channelService.list).toHaveBeenLastCalledWith({
        channel: "KOOK",
        subchannel: "",
        publishdate: "",
        current: 1,
        pagesize: 50,
      }),
    );
    router.dispose();
  });
  it("单独日期查询隐藏失真总数，短页阻止继续翻页", async () => {
    const router = setup("/channels?publishdate=2000-01-01");
    await screen.findByText("渠道新闻 1");
    expect(screen.queryByText(/175016/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
    expect(channelService.list).toHaveBeenCalledTimes(1);
    router.dispose();
  });
  it("下一页为空保留上一页，不按错误总数继续请求", async () => {
    vi.mocked(channelService.list).mockImplementation(async (q) =>
      materialPage(q.current === 1 ? 10 : 0, q.current, 10, 175016),
    );
    const router = setup("/channels?pagesize=10");
    await screen.findByText("渠道新闻 10");
    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(await screen.findByText("渠道新闻 10")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        new URLSearchParams(router.state.location.search).get("current"),
      ).toBe("1"),
    );
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
    expect(channelService.list).toHaveBeenCalledTimes(2);
    expect(channelQueryMemory.read()?.current).toBe(1);
    router.dispose();
  });
  it("最新请求优先，旧响应无法覆盖新结果", async () => {
    const old = deferred<PromotePage>();
    vi.mocked(channelService.list)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({
        ...materialPage(),
        data: [{ ...material(2), title: "最新结果" }],
      });
    const router = setup();
    await screen.findByRole("option", { name: "KOOK" });
    await userEvent.selectOptions(
      screen.getByLabelText("渠道", { exact: true }),
      "KOOK",
    );
    await userEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(await screen.findByText("最新结果")).toBeInTheDocument();
    await act(async () =>
      old.resolve({
        ...materialPage(),
        data: [{ ...material(1), title: "旧结果" }],
      }),
    );
    expect(screen.queryByText("旧结果")).not.toBeInTheDocument();
    expect(screen.getByText("最新结果")).toBeInTheDocument();
    router.dispose();
  });
  it("渠道配置和列表可独立失败、重试", async () => {
    vi.mocked(channelService.groups).mockRejectedValueOnce(
      new Error("配置读取失败"),
    );
    vi.mocked(channelService.list).mockRejectedValueOnce(
      new Error("素材读取失败"),
    );
    const router = setup();
    await screen.findByText("素材读取失败");
    expect(screen.getByText(/配置读取失败/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试素材列表" }));
    expect(await screen.findByText("渠道新闻 1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试渠道选项" }));
    await screen.findByRole("option", { name: "KOOK" });
    expect(channelService.list).toHaveBeenCalledTimes(2);
    router.dispose();
  });
  it("详情显示摘要、空值和图片占位，正文按纯文本渲染", async () => {
    const router = setup();
    await screen.findByText("渠道新闻 1");
    await userEvent.click(screen.getByRole("button", { name: "查看素材 1" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getByText(
        "这是摘要 <script>不会执行</script>",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getAllByText("暂无图片"),
    ).toHaveLength(2);
    expect(
      within(screen.getByRole("dialog")).getByText("https://example.com/news"),
    ).toBeInTheDocument();
    expect(
      document.querySelector("dialog script, [role=dialog] script"),
    ).toBeNull();
    expect(channelService.list).toHaveBeenCalledTimes(1);
    router.dispose();
  });
  it("非法链接筛选恢复默认值", () => {
    expect(
      readChannelQuery(
        new URLSearchParams("current=-1&pagesize=200&publishdate=2026-02-30"),
      ),
    ).toEqual({
      channel: "",
      subchannel: "",
      publishdate: "",
      current: 1,
      pagesize: 30,
    });
  });

  it("标题下显示双图和实际元信息，点击图片打开共用详情", async () => {
    vi.mocked(promoteImages.acquire).mockImplementation(async (url) => ({
      src: `blob:${url}`,
      width: 281,
      height: 125,
      byteSize: 39116,
      release: vi.fn(),
    }));
    vi.mocked(channelService.list).mockResolvedValue({
      ...materialPage(),
      data: [
        {
          ...material(),
          subChannel: "头条_999x999",
          titlePic: "https://images.test/main.png",
          titlePic2: "https://images.test/second.png",
        },
      ],
    });
    const router = setup();
    expect(await screen.findAllByText("281 × 125 px")).toHaveLength(2);
    expect(screen.getAllByText("38.2 KB")).toHaveLength(2);
    expect(screen.getAllByRole("img")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "预览主图" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(
      await within(screen.getByRole("dialog")).findAllByText("281 × 125 px"),
    ).toHaveLength(2);
    router.dispose();
  });

  it("离开返回恢复已提交条件和页码，丢弃未搜索修改且不先请求默认页", async () => {
    const router = setup(
      "/channels?channel=KOOK&subchannel=轮播图&publishdate=2026-10-23&current=3&pagesize=20",
    );
    await screen.findByText("渠道新闻 1");
    await userEvent.selectOptions(
      screen.getByLabelText("渠道", { exact: true }),
      "2345",
    );
    await act(() => router.navigate("/elsewhere"));
    vi.mocked(channelService.list).mockClear();
    await act(() => router.navigate("/channels"));
    await screen.findByText("渠道新闻 1");
    expect(channelService.list).toHaveBeenCalledTimes(1);
    expect(channelService.list).toHaveBeenLastCalledWith({
      channel: "KOOK",
      subchannel: "轮播图",
      publishdate: "2026-10-23",
      current: 3,
      pagesize: 20,
    });
    expect(screen.getByLabelText("渠道", { exact: true })).toHaveValue("KOOK");
    expect(screen.getByLabelText("子渠道", { exact: true })).toHaveValue(
      "轮播图",
    );
    expect(screen.getByLabelText("发布日期")).toHaveValue("2026-10-23");
    router.dispose();
  });

  it("显式 URL 优先，前进后退更新记忆，重置也可在返回时恢复", async () => {
    channelQueryMemory.remember({
      channel: "2345",
      subchannel: "头条图",
      publishdate: "",
      current: 5,
      pagesize: 50,
    });
    const router = setup("/channels?channel=KOOK&current=2&pagesize=10");
    await screen.findByText("渠道新闻 1");
    expect(channelQueryMemory.read()?.channel).toBe("KOOK");
    await act(() =>
      router.navigate("/channels?channel=2345&current=4&pagesize=20"),
    );
    await waitFor(() => expect(channelQueryMemory.read()?.current).toBe(4));
    await act(() => router.navigate(-1));
    await waitFor(() => expect(channelQueryMemory.read()?.current).toBe(2));
    await act(() => router.navigate(1));
    await waitFor(() => expect(channelQueryMemory.read()?.current).toBe(4));
    await userEvent.click(screen.getByRole("button", { name: "重置" }));
    await waitFor(() =>
      expect(channelQueryMemory.read()).toEqual({
        channel: "",
        subchannel: "",
        publishdate: "",
        current: 1,
        pagesize: 20,
      }),
    );
    await act(() => router.navigate("/elsewhere"));
    await act(() => router.navigate("/channels"));
    await screen.findByText("渠道新闻 1");
    expect(screen.getByLabelText("每页条数")).toHaveValue("20");
    expect(channelService.list).toHaveBeenLastCalledWith(
      channelQueryMemory.read(),
    );
    router.dispose();
  });

  it("首次默认查询也写入地址，后退可以恢复默认条件", async () => {
    const router = setup();
    await screen.findByText("渠道新闻 1");
    expect(
      new URLSearchParams(router.state.location.search).get("current"),
    ).toBe("1");
    await userEvent.selectOptions(
      screen.getByLabelText("渠道", { exact: true }),
      "KOOK",
    );
    await userEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() =>
      expect(channelQueryMemory.read()?.channel).toBe("KOOK"),
    );
    await act(() => router.navigate(-1));
    await waitFor(() =>
      expect(screen.getByLabelText("渠道", { exact: true })).toHaveValue(""),
    );
    expect(channelQueryMemory.read()?.channel).toBe("");
    router.dispose();
  });
});
