import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import Channels from "@/pages/Channels";
import { channelService } from "@/features/channels/service";
import {
  channelEditBuffers,
  recordInput,
} from "@/features/channels/edit-buffer";
import { channelQueryMemory } from "@/features/channels/query-memory";
import { materialColumns } from "@/features/channels/table-model";
import { imageService } from "@/features/images/service";
import { imagePresetsIpc } from "@/services/tauri/image-presets";
import { AppProviders } from "@/app/providers";
import { promoteRecordSchema } from "@/types/cms";
import { deferred, material, materialPage, session } from "./cms-fixtures";

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ session }) }));
vi.mock("@/services/tauri/image-presets", () => ({
  imagePresetsIpc: { list: vi.fn() },
}));
vi.mock("@/features/images/service", async (original) => ({
  ...(await original<typeof import("@/features/images/service")>()),
  imageService: { inspect: vi.fn(), process: vi.fn() },
}));
vi.mock("@/features/auth/service", () => ({
  authService: { getSnapshot: () => ({ status: "authenticated" }) },
}));
vi.mock("@/features/channels/MaterialImage", () => ({
  MaterialImage: ({ label }: { label: string }) => <span>{label}</span>,
}));
vi.mock("@/features/channels/service", async (original) => ({
  ...(await original<typeof import("@/features/channels/service")>()),
  channelService: {
    groups: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    order: vi.fn(),
    upload: vi.fn(),
    openLink: vi.fn(),
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => "blob:channel-image");
  URL.revokeObjectURL = vi.fn();
  vi.mocked(imagePresetsIpc.list).mockResolvedValue([]);
  vi.mocked(imageService.inspect).mockResolvedValue({
    width: 280,
    height: 124,
    format: "png",
    byteSize: 5,
    previewBase64: "AQID",
  });
  vi.mocked(imageService.process).mockResolvedValue({
    result: {
      file: new File(["image"], "processed.png", { type: "image/png" }),
      width: 280,
      height: 124,
      format: "png",
      byteSize: 5,
    },
    quality: null,
    lossy: false,
  });
  channelEditBuffers.clear();
  channelQueryMemory.clear();
  vi.mocked(channelService.groups).mockResolvedValue([
    { channel: "KOOK", subchannels: ["轮播图"] },
  ]);
  vi.mocked(channelService.list).mockImplementation(async (q) =>
    materialPage(2, q.current, q.pagesize),
  );
  vi.mocked(channelService.get).mockImplementation(async (id) => ({
    ...material(id),
    titlePic: "https://images.example/main.jpg",
  }));
  vi.mocked(channelService.create).mockResolvedValue({ succeeded: true });
  vi.mocked(channelService.update).mockResolvedValue({ succeeded: true });
  vi.mocked(channelService.remove).mockResolvedValue({ succeeded: true });
  vi.mocked(channelService.order).mockResolvedValue({ succeeded: true });
  vi.mocked(channelService.openLink).mockResolvedValue(null);
});
const full =
  "/channels?channel=KOOK&subchannel=轮播图&publishdate=2026-10-21&current=2&pagesize=10";
async function setup(path = full) {
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
  await screen.findByText("渠道新闻 1");
  return router;
}
describe("渠道素材写操作", () => {
  it("列配置仅改变展示，排序期间锁定配置和列宽", async () => {
    const router = await setup();
    const requestCount = vi.mocked(channelService.list).mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "列配置" }));
    expect(
      screen.getByRole("menuitemcheckbox", { name: "标题" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("menuitemcheckbox", { name: "操作" }),
    ).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "作者" }),
    );
    await userEvent.keyboard("{Escape}");
    expect(
      screen.queryByRole("columnheader", { name: "作者" }),
    ).not.toBeInTheDocument();
    const resize = screen.getByRole("separator", { name: "调整 标题 列宽" });
    resize.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(resize).toHaveAttribute("aria-valuenow", "330");
    expect(channelService.list).toHaveBeenCalledTimes(requestCount);
    expect(router.state.location.search).toContain("current=2");
    await userEvent.click(screen.getByRole("button", { name: "开始排序" }));
    expect(screen.getByRole("button", { name: "列配置" })).toBeDisabled();
    expect(resize).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(resize, { key: "ArrowRight" });
    expect(resize).toHaveAttribute("aria-valuenow", "330");
    expect(
      screen.queryByRole("separator", { name: "调整 拖动排序 列宽" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "取消排序" }));
    expect(screen.getByRole("button", { name: "列配置" })).toBeEnabled();
    expect(resize).toHaveAttribute("aria-disabled", "false");
    expect(channelService.order).not.toHaveBeenCalled();
    router.dispose();
  });
  it("列顺序对齐网页，文章编号和外链通过服务打开", async () => {
    const router = await setup();
    const headers = within(screen.getByRole("table"))
      .getAllByRole("columnheader")
      .map((e) => e.textContent);
    expect(headers).toEqual([
      ...materialColumns.map(([, name]) => name),
      "操作",
    ]);
    await userEvent.click(screen.getByRole("link", { name: "101" }));
    expect(channelService.openLink).toHaveBeenCalledWith(
      "https://mini.jnnc.com/h/101.html?zn=mr",
    );
    await userEvent.click(
      screen.getAllByRole("link", { name: "https://example.com/news" })[0],
    );
    expect(channelService.openLink).toHaveBeenLastCalledWith(
      "https://example.com/news",
    );
    router.dispose();
  });
  it.each([
    "subchannel=轮播图&publishdate=2026-10-21",
    "channel=KOOK&publishdate=2026-10-21",
    "channel=KOOK&subchannel=轮播图",
  ])("缺少任一条件时不能排序：%s", async (params) => {
    const router = await setup(`/channels?${params}`);
    expect(screen.getByRole("button", { name: "开始排序" })).toBeDisabled();
    router.dispose();
  });
  it("未提交条件禁止排序，当前页不足两条禁止排序", async () => {
    const router = await setup();
    await userEvent.clear(
      screen.getByLabelText("发布日期", { selector: "input" }),
    );
    expect(screen.getByRole("button", { name: "开始排序" })).toBeDisabled();
    vi.mocked(channelService.list).mockImplementation(async (q) =>
      materialPage(1, q.current, q.pagesize),
    );
    await userEvent.type(
      screen.getByLabelText("发布日期", { selector: "input" }),
      "2026-10-22",
    );
    await userEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(
      await screen.findByText("当前页至少需要两条素材"),
    ).toBeInTheDocument();
    router.dispose();
  });
  it("原生拖放只提交当前页，排序失败保留并可重试，期间锁定操作", async () => {
    const router = await setup();
    await userEvent.click(screen.getByRole("button", { name: "开始排序" }));
    expect(screen.getByRole("combobox", { name: "渠道" })).toBeDisabled();
    expect(screen.getByLabelText("每页条数")).toBeDisabled();
    expect(screen.getByRole("button", { name: "新增" })).toBeDisabled();
    const transfer = {
      setData: vi.fn(),
      setDragImage: vi.fn(),
      effectAllowed: "",
    };
    const handle = screen.getByLabelText("拖动素材 2");
    fireEvent.dragStart(handle, {
      dataTransfer: transfer,
    });
    expect(transfer.setDragImage).toHaveBeenCalledWith(
      handle.closest("tr"),
      expect.any(Number),
      expect.any(Number),
    );
    fireEvent.drop(screen.getByLabelText("拖动素材 1").closest("tr")!, {
      dataTransfer: transfer,
    });
    expect(
      [...document.querySelectorAll("tbody tr")].map((e) =>
        e.getAttribute("data-material-id"),
      ),
    ).toEqual(["2", "1"]);
    const pending = deferred<{ succeeded: true }>();
    vi.mocked(channelService.order).mockReturnValueOnce(pending.promise);
    await userEvent.dblClick(screen.getByRole("button", { name: "保存排序" }));
    expect(channelService.order).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "列配置" })).toBeDisabled();
    expect(
      screen.getByRole("separator", { name: "调整 标题 列宽" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(channelService.order).toHaveBeenCalledWith(
      {
        channel: "KOOK",
        subchannel: "轮播图",
        publishdate: "2026-10-21",
        current: 2,
        pagesize: 10,
      },
      [2, 1],
    );
    await act(async () => pending.reject(new Error("排序保存失败")));
    expect(screen.getByLabelText("上移素材 2")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "保存排序" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "开始排序" })).toBeEnabled(),
    );
    router.dispose();
  });
  it("键盘移动后取消恢复原顺序，离开可取消或放弃排序", async () => {
    const router = await setup();
    await userEvent.click(screen.getByRole("button", { name: "开始排序" }));
    await userEvent.click(screen.getByLabelText("下移素材 1"));
    await act(async () => {
      void router.navigate("/elsewhere");
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "留在此页" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "取消排序" }));
    expect(
      [...document.querySelectorAll("tbody tr")].map((e) =>
        e.getAttribute("data-material-id"),
      ),
    ).toEqual(["1", "2"]);
    expect(channelService.order).not.toHaveBeenCalled();
    router.dispose();
  });
  it("WebView 未启动 HTML5 拖放时，按指针落点移动，轻点不排序", async () => {
    const router = await setup();
    await userEvent.click(screen.getByRole("button", { name: "开始排序" }));
    const handle = screen.getByLabelText("拖动素材 2");
    const target = screen.getByLabelText("拖动素材 1").closest("tr")!;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => target,
    });
    const pointerEvent = (type: string, x: number, y: number) =>
      fireEvent(
        handle,
        new MouseEvent(type, {
          bubbles: true,
          button: 0,
          clientX: x,
          clientY: y,
        }),
      );
    pointerEvent("pointerdown", 10, 100);
    pointerEvent("pointerup", 10, 102);
    expect(
      [...document.querySelectorAll("tbody tr")].map((e) =>
        e.getAttribute("data-material-id"),
      ),
    ).toEqual(["1", "2"]);
    pointerEvent("pointerdown", 10, 100);
    pointerEvent("pointerup", 10, 20);
    expect(
      [...document.querySelectorAll("tbody tr")].map((e) =>
        e.getAttribute("data-material-id"),
      ),
    ).toEqual(["2", "1"]);
    expect(channelService.order).not.toHaveBeenCalled();
    Reflect.deleteProperty(document, "elementFromPoint");
    router.dispose();
  });
  it("新增独立初始化、必填校验、保存防重复及失败保留", async () => {
    const router = await setup();
    await userEvent.click(screen.getByRole("button", { name: "新增" }));
    await userEvent.click(screen.getByRole("button", { name: "保存素材" }));
    expect(channelService.create).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("* Channel"), "2345");
    await userEvent.type(
      screen.getByLabelText("* Title", { exact: true }),
      "新标题",
    );
    await userEvent.type(
      screen.getByLabelText("* TitlePic", { exact: true }),
      "https://img.example/a.jpg",
    );
    const pending = deferred<{ succeeded: true }>();
    vi.mocked(channelService.create).mockReturnValueOnce(pending.promise);
    await userEvent.dblClick(screen.getByRole("button", { name: "保存素材" }));
    expect(channelService.create).toHaveBeenCalledTimes(1);
    await act(async () => pending.reject(new Error("结果未确认，请刷新核对")));
    expect(await screen.findByRole("alert")).toHaveTextContent("结果未确认");
    expect(screen.getByLabelText("* Title", { exact: true })).toHaveValue(
      "新标题",
    );
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    await userEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    await userEvent.click(screen.getByRole("button", { name: "新增" }));
    expect(screen.getByLabelText("* Channel")).toHaveValue("");
    expect(screen.getByLabelText("* Title", { exact: true })).toHaveValue("");
    router.dispose();
  });
  it("修改先获取详情，只覆盖表单字段，成功后刷新同一页", async () => {
    const base = promoteRecordSchema.parse({
      ...material(1),
      titlePic: "https://images.example/main.jpg",
      CustomMeta: { unchanged: true },
    });
    vi.mocked(channelService.get).mockResolvedValueOnce(base);
    const router = await setup();
    await userEvent.click(screen.getByLabelText("编辑素材 1"));
    await screen.findByRole("dialog", { name: "修改素材" });
    await userEvent.clear(screen.getByLabelText("* Title", { exact: true }));
    await userEvent.type(
      screen.getByLabelText("* Title", { exact: true }),
      "修改后标题",
    );
    await userEvent.click(screen.getByRole("button", { name: "保存素材" }));
    await waitFor(() =>
      expect(channelService.update).toHaveBeenCalledWith({
        ...base,
        title: "修改后标题",
      }),
    );
    await waitFor(() => expect(channelService.list).toHaveBeenCalledTimes(2));
    expect(router.state.location.search).toContain("current=2");
    expect(channelEditBuffers.get(6)).toBeNull();
    router.dispose();
  });
  it("上传成功只回填对应地址，保存成功但刷新失败分别提示", async () => {
    const router = await setup();
    await userEvent.click(screen.getByRole("button", { name: "新增" }));
    await userEvent.type(screen.getByLabelText("* Channel"), "2345");
    await userEvent.type(
      screen.getByLabelText("* Title", { exact: true }),
      "上传测试",
    );
    await userEvent.type(
      screen.getByLabelText("* TitlePic", { exact: true }),
      "https://img.example/main.png",
    );
    vi.mocked(channelService.upload).mockResolvedValueOnce({
      url: "https://img.example/second.png",
    });
    await userEvent.upload(
      screen.getByLabelText("上传 TitlePic2", { exact: true }),
      new File(["image"], "second.png", { type: "image/png" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "处理预览" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "确认结果" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "TitlePic2" })).toHaveValue(
        "https://img.example/second.png",
      ),
    );
    expect(screen.getByLabelText("* TitlePic", { exact: true })).toHaveValue(
      "https://img.example/main.png",
    );
    expect(channelService.create).not.toHaveBeenCalled();
    vi.mocked(channelService.list).mockRejectedValueOnce(
      new Error("刷新网络失败"),
    );
    await userEvent.click(screen.getByRole("button", { name: "保存素材" }));
    expect((await screen.findAllByText("素材已保存")).length).toBeGreaterThan(
      0,
    );
    expect(
      await screen.findByText("操作已完成，但列表刷新失败，请重试列表"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    router.dispose();
  });
  it("删除取消无请求，删除末页后回退并更新记忆", async () => {
    const router = await setup();
    await userEvent.click(screen.getByLabelText("删除素材 1"));
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(channelService.remove).not.toHaveBeenCalled();
    vi.mocked(channelService.list).mockImplementation(async (q) =>
      materialPage(q.current === 2 ? 0 : 2, q.current, q.pagesize),
    );
    await userEvent.click(screen.getByLabelText("删除素材 1"));
    await userEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() =>
      expect(
        new URLSearchParams(router.state.location.search).get("current"),
      ).toBe("1"),
    );
    await waitFor(() => expect(channelQueryMemory.read()?.current).toBe(1));
    router.dispose();
  });
  it("上传失败可重试，等待期间不能保存，取消后旧上传不回填", async () => {
    const router = await setup();
    await userEvent.click(screen.getByRole("button", { name: "新增" }));
    const file = new File(["image"], "test.png", { type: "image/png" });
    vi.mocked(channelService.upload).mockRejectedValueOnce(
      new Error("上传失败"),
    );
    await userEvent.upload(
      screen.getByLabelText("上传 TitlePic", { exact: true }),
      file,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "处理预览" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "确认结果" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("上传失败");
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    const pending = deferred<{ url: string }>();
    vi.mocked(channelService.upload).mockReturnValueOnce(pending.promise);
    await userEvent.upload(
      screen.getByLabelText("上传 TitlePic", { exact: true }),
      file,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "处理预览" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "确认结果" }));
    expect(
      screen.getByRole("button", { name: "保存素材", hidden: true }),
    ).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "取消回填" }));
    expect(screen.getByRole("button", { name: "保存素材" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    await userEvent.click(screen.getByRole("button", { name: "新增" }));
    await act(async () =>
      pending.resolve({ url: "https://img.example/late.png" }),
    );
    expect(screen.getByLabelText("* TitlePic", { exact: true })).toHaveValue(
      "",
    );
    expect(channelService.create).not.toHaveBeenCalled();
    router.dispose();
  });
  it("同账号恢复表单缓冲，离开确认丢弃", async () => {
    const base = {
      ...material(1),
      titlePic: "https://images.example/main.jpg",
    };
    channelEditBuffers.set(6, {
      base,
      input: { ...recordInput(base), title: "未保存标题" },
    });
    const router = await setup();
    expect(screen.getByLabelText("* Title", { exact: true })).toHaveValue(
      "未保存标题",
    );
    await act(async () => {
      void router.navigate("/elsewhere");
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "放弃并离开" }),
    );
    await screen.findByText("其他页面");
    expect(channelEditBuffers.get(6)).toBeNull();
    router.dispose();
  });
});
