import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppProviders } from "@/app/providers";
import Channels from "@/pages/Channels";
import { channelService } from "@/features/channels/service";
import { channelDraftService } from "@/features/channels/draft-service";
import {
  blankInput,
  channelEditBuffers,
} from "@/features/channels/edit-buffer";
import { material, materialPage, session } from "./cms-fixtures";

vi.mock("@/lib/platform", () => ({
  isAndroid: () => true,
  isDemo: () => false,
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ session }) }));
vi.mock("@/features/auth/service", () => ({
  authService: { getSnapshot: () => ({ status: "authenticated" }) },
}));
vi.mock("@/features/channels/draft-service", () => ({
  channelDraftService: { load: vi.fn(), save: vi.fn(), clear: vi.fn() },
}));
vi.mock("@/features/channels/MaterialImage", () => ({
  MaterialImage: ({ label }: { label: string }) => <span>{label}</span>,
}));
vi.mock("@/services/tauri/image-presets", () => ({
  imagePresetsIpc: { list: vi.fn(async () => []) },
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
const full =
  "/channels?channel=KOOK&subchannel=轮播图&publishdate=2026-10-21&current=1&pagesize=20";
const saved = {
  base: null,
  input: { ...blankInput(), title: "演示：本机恢复标题" },
};
beforeEach(() => {
  vi.clearAllMocks();
  channelEditBuffers.clear();
  vi.mocked(channelDraftService.load).mockResolvedValue(null);
  vi.mocked(channelDraftService.save).mockResolvedValue();
  vi.mocked(channelDraftService.clear).mockResolvedValue();
  vi.mocked(channelService.groups).mockResolvedValue([
    { channel: "KOOK", subchannels: ["轮播图"] },
    { channel: "演示渠道", subchannels: ["演示子渠道"] },
  ]);
  vi.mocked(channelService.list).mockImplementation(async (q) =>
    materialPage(2, q.current, q.pagesize),
  );
  vi.mocked(channelService.get).mockImplementation(async (id) => material(id));
  vi.mocked(channelService.order).mockResolvedValue({ succeeded: true });
});
async function setup(path = full) {
  const router = createMemoryRouter(
    [
      { path: "/channels", element: <Channels /> },
      { path: "/elsewhere", element: <p>其他页面</p> },
    ],
    { initialEntries: [path] },
  );
  const view = render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  await screen.findByText("渠道新闻 1");
  await waitFor(() => expect(channelDraftService.load).toHaveBeenCalled());
  return { router, ...view };
}
describe("Android 渠道样板", () => {
  it("筛选草案取消不查询，换渠道清子渠道，应用后才查询", async () => {
    const { router } = await setup();
    await userEvent.click(screen.getByRole("button", { name: "筛选 3" }));
    await userEvent.click(screen.getByRole("button", { name: "KOOK" }));
    await userEvent.click(screen.getByRole("option", { name: "演示渠道" }));
    expect(screen.getByRole("button", { name: "全部子渠道" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(channelService.list).toHaveBeenCalledTimes(1);
    expect(router.state.location.search).toContain("channel=KOOK");
    await userEvent.click(screen.getByRole("button", { name: "筛选 3" }));
    await userEvent.click(screen.getByRole("button", { name: "KOOK" }));
    await userEvent.click(screen.getByRole("option", { name: "演示渠道" }));
    await userEvent.click(screen.getByRole("button", { name: "应用筛选" }));
    await waitFor(() => expect(channelService.list).toHaveBeenCalledTimes(2));
    expect(vi.mocked(channelService.list).mock.lastCall?.[0]).toMatchObject({
      channel: "演示渠道",
      subchannel: "",
      current: 1,
      pagesize: 20,
    });
    router.dispose();
  });
  it("草稿读取失败可重试，恢复后自动保存并可保留返回", async () => {
    vi.mocked(channelDraftService.load)
      .mockRejectedValueOnce(new Error("演示：读取失败"))
      .mockResolvedValue(saved);
    const { router } = await setup();
    await screen.findByRole("heading", { name: "本机草稿读取失败" });
    await userEvent.click(screen.getByRole("button", { name: "重试读取" }));
    await screen.findByRole("heading", { name: "恢复本机素材草稿？" });
    await userEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByLabelText("* 标题", {})).toHaveValue(saved.input.title);
    fireEvent.change(screen.getByLabelText("* 标题", {}), {
      target: { value: "演示：修改后的标题" },
    });
    await waitFor(() =>
      expect(channelDraftService.save).toHaveBeenCalledWith(
        session.user.userId,
        expect.objectContaining({
          input: expect.objectContaining({ title: "演示：修改后的标题" }),
        }),
      ),
    );
    expect(
      screen.queryByRole("button", { name: /AI 优化/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    await userEvent.click(
      screen.getByRole("button", { name: "保留草稿并返回" }),
    );
    await screen.findByRole("button", { name: "继续本机草稿" });
    expect(channelService.create).not.toHaveBeenCalled();
    expect(channelService.update).not.toHaveBeenCalled();
    router.dispose();
  });
  it("从详情和编辑返回保留列表位置，重新进入页面也恢复", async () => {
    const first = await setup();
    const viewport = screen.getByRole("region", { name: "渠道素材内容" });
    viewport.scrollTop = 640;
    fireEvent.scroll(viewport);
    await userEvent.click(screen.getByRole("button", { name: "渠道新闻 1" }));
    await screen.findByRole("heading", { name: "素材详情" });
    await userEvent.keyboard("{Escape}");
    expect(viewport.scrollTop).toBe(640);
    await userEvent.click(screen.getAllByRole("button", { name: "编辑" })[0]);
    await screen.findByRole("heading", { name: "修改素材" });
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(viewport.scrollTop).toBe(640);
    first.unmount();
    first.router.dispose();
    const next = await setup();
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "渠道素材内容" }).scrollTop,
      ).toBe(640),
    );
    next.router.dispose();
  });
  it("当前页排序使用移动按钮，提交期间锁定并发送完整顺序", async () => {
    const { router } = await setup();
    await userEvent.click(screen.getByRole("button", { name: "排序" }));
    await userEvent.click(screen.getAllByRole("button", { name: "下移" })[0]);
    const list = screen.getByRole("region", { name: "渠道素材内容" });
    expect(within(list).getAllByRole("listitem")[0]).toHaveAttribute(
      "data-material-id",
      "2",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "保存当前页排序" }),
    );
    await waitFor(() =>
      expect(channelService.order).toHaveBeenCalledWith(
        expect.objectContaining({ current: 1, pagesize: 20 }),
        [2, 1],
      ),
    );
    router.dispose();
  });
});
