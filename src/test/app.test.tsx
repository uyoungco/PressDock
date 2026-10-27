import { describe, it, expect, vi, beforeEach } from "vitest";
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
import { Provider, createStore } from "jotai";
import { AppProviders } from "@/app/providers";
import { routes } from "@/app/router";
import { themeAtom } from "@/atoms/theme";
import { sidebarOpenAtom } from "@/atoms/navigation";
import { editorDirtyAtom, editorStatusAtom } from "@/atoms/editor";
import { cmsIpc } from "@/services/tauri/cms";
import { imagePresetsIpc } from "@/services/tauri/image-presets";
import { systemService } from "@/services/tauri/system";
import { authService } from "@/features/auth/service";
import {
  emptyPresets,
  type ChannelImagePresets,
} from "@/features/image-presets/model";
import { deferred } from "./cms-fixtures";
import { chooseOption } from "./select-helpers";

vi.mock("@/services/tauri/articles", () => ({
  articleIpc: {
    classes: vi.fn(async () => [{ id: 1, name: "演示分类" }]),
    list: vi.fn(async (query) => ({
      data: [],
      total: 0,
      current: query.current,
      pageSize: query.pagesize,
    })),
  },
}));
vi.mock("@/services/tauri/cms", () => ({
  cmsIpc: {
    restore: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    channels: vi.fn(async () => []),
  },
}));
vi.mock("@/services/tauri/image-presets", () => ({
  imagePresetsIpc: {
    list: vi.fn(async () => []),
    save: vi.fn(),
  },
}));
vi.mock("@/features/ai/service", () => ({
  aiService: {
    load: vi.fn(async () => ({ providers: [], models: [], templates: [] })),
  },
}));
vi.mock("@/services/tauri/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/tauri/client")>()),
  isDesktop: vi.fn(() => true),
}));
vi.mock("@/services/cms", async () => ({
  articleService: new (await import("@/services/cms/mock")).MockCmsAdapter(),
}));
vi.mock("@/services/tauri/system", () => ({
  systemService: {
    getAppInfo: vi.fn(async () => ({
      name: "PressDock",
      version: "0.1.0",
      platform: "test",
    })),
    healthCheck: vi.fn(async () => ({ ready: true })),
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  authService.useLoginForm();
  vi.mocked(cmsIpc.channels).mockResolvedValue([]);
  vi.mocked(imagePresetsIpc.list).mockResolvedValue([]);
  vi.mocked(imagePresetsIpc.save).mockImplementation(
    async (request) => request,
  );
  vi.mocked(cmsIpc.restore).mockResolvedValue({
    user: { userId: 6, nickname: "editor", roles: ["admin"], perms: ["admin"] },
    persistent: true,
  });
});

describe("工作区", () => {
  it("文章分类导航与每页条数可选择，主题选择继续持久化", async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ["/articles"],
    });
    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    // 内容卡片不再重复显示栏目标题，等待筛选区域确认文章页已就绪。
    await screen.findByRole("form", { name: "文章筛选" }, { timeout: 5000 });
    await screen.findByText("暂无符合条件的文章");
    await chooseOption(screen.getByLabelText("每页条数"), "500");
    expect(router.state.location.search).toContain("pagesize=500");
    await userEvent.click(screen.getByRole("link", { name: "系统设置" }));
    await chooseOption(
      await screen.findByLabelText("界面主题", {}, { timeout: 5000 }),
      "深色",
    );
    expect(screen.getByLabelText("界面主题")).toHaveTextContent("深色");
    expect(localStorage.getItem("pressdock.theme")).toBe('"dark"');
    expect(document.documentElement).toHaveClass("dark");
    await chooseOption(screen.getByLabelText("界面主题"), "浅色");
    expect(document.documentElement).not.toHaveClass("dark");
    router.dispose();
  });
  it("渲染工作台并能切换路由", async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ["/dashboard"],
    });
    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    expect(
      await screen.findByRole("heading", { name: "工作台" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("城市更新，让老街区焕发新活力"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "系统设置" }));
    expect(
      await screen.findByRole("heading", { name: "系统设置" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "服务连接" }));
    expect(
      await screen.findByText("Rust 与 SQLite 已就绪"),
    ).toBeInTheDocument();
    expect(screen.getByText("当前账号：editor · 角色：admin")).toBeVisible();
    expect(screen.getByText("会话已安全保存，重启后验证恢复。")).toBeVisible();
    expect(screen.getByText("可配置")).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: "关于应用" }));
    expect(
      screen.getByRole("tabpanel", { name: "关于应用" }),
    ).toHaveTextContent("PressDock v0.1.0");
    router.dispose();
  });
  it("设置默认展示常规模块，支持键盘导航且隐藏预设不参与焦点导航", async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(routes, {
      initialEntries: ["/settings"],
    });
    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    const general = await screen.findByRole("tab", { name: "常规设置" });
    expect(screen.getAllByRole("tab")).toHaveLength(7);
    expect(general).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByLabelText("预设渠道")).not.toBeVisible();
    await user.click(general);
    await user.tab();
    expect(screen.getByRole("tabpanel", { name: "常规设置" })).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText("界面主题")).toHaveFocus();
    general.focus();
    for (const name of [
      "采集与 AI 处理",
      "图片预设",
      "服务连接",
      "AI 模型",
      "提示词模板",
      "关于应用",
    ]) {
      await user.keyboard("{ArrowRight}");
      expect(screen.getByRole("tab", { name })).toHaveFocus();
      expect(screen.getByRole("tab", { name })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByRole("tabpanel", { name })).toBeVisible();
      expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    }
    await user.keyboard("{Home}");
    expect(general).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "关于应用" })).toHaveFocus();
    expect(systemService.getAppInfo).toHaveBeenCalledTimes(1);
    expect(systemService.healthCheck).toHaveBeenCalledTimes(1);
    expect(imagePresetsIpc.list).toHaveBeenCalledTimes(1);
    expect(imagePresetsIpc.save).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "文章管理" }));
    await user.click(screen.getByRole("link", { name: "优质文章" }));
    await screen.findByRole("form", { name: "文章筛选" });
    await user.click(screen.getByRole("link", { name: "系统设置" }));
    expect(
      await screen.findByRole("tab", { name: "常规设置", selected: true }),
    ).toBeVisible();
    router.dispose();
  });
  it("切换设置标签保留预设草稿和复制来源，隐藏期间保存失败可重试并完成", async () => {
    const user = userEvent.setup();
    vi.mocked(cmsIpc.channels).mockResolvedValue([
      { channel: "A", subchannels: ["轮播图"] },
      { channel: "B", subchannels: ["轮播图"] },
    ]);
    vi.mocked(imagePresetsIpc.list).mockResolvedValue([
      { ...emptyPresets("A", "轮播图"), titlePic: { format: "png" } },
    ]);
    const router = createMemoryRouter(routes, {
      initialEntries: ["/settings"],
    });
    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    await user.click(await screen.findByRole("tab", { name: "图片预设" }));
    await chooseOption(screen.getByLabelText("预设渠道"), "B");
    await chooseOption(screen.getByLabelText("预设子渠道"), "轮播图");
    await chooseOption(screen.getByLabelText("复制来源"), "A / 轮播图");
    fireEvent.change(screen.getByLabelText("TitlePic 体积上限（KiB）"), {
      target: { value: "100" },
    });
    await user.click(screen.getByRole("tab", { name: "服务连接" }));
    expect(screen.getByLabelText("预设渠道")).not.toBeVisible();
    await user.click(screen.getByRole("tab", { name: "图片预设" }));
    expect(screen.getByLabelText("预设渠道")).toHaveTextContent("B");
    expect(screen.getByLabelText("预设子渠道")).toHaveTextContent("轮播图");
    expect(screen.getByLabelText("复制来源")).toHaveTextContent("A / 轮播图");
    expect(screen.getByLabelText("TitlePic 体积上限（KiB）")).toHaveValue(100);
    expect(imagePresetsIpc.save).not.toHaveBeenCalled();

    const saving = deferred<ChannelImagePresets>();
    vi.mocked(imagePresetsIpc.save).mockReturnValueOnce(saving.promise);
    await user.click(screen.getByRole("button", { name: "保存图片预设" }));
    await user.click(screen.getByRole("tab", { name: "关于应用" }));
    await user.click(screen.getByRole("tab", { name: "图片预设" }));
    expect(
      screen.getByRole("button", { name: "正在保存预设…" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("预设渠道")).toBeDisabled();
    expect(screen.getByLabelText("复制来源")).toBeDisabled();
    expect(imagePresetsIpc.save).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("tab", { name: "常规设置" }));
    await act(async () => saving.reject(new Error("磁盘写入失败")));
    await user.click(screen.getByRole("tab", { name: "图片预设" }));
    expect(screen.getByRole("alert")).toHaveTextContent("磁盘写入失败");
    expect(screen.getByLabelText("TitlePic 体积上限（KiB）")).toHaveValue(100);

    const retry = deferred<ChannelImagePresets>();
    vi.mocked(imagePresetsIpc.save).mockReturnValueOnce(retry.promise);
    await user.click(screen.getByRole("button", { name: "保存图片预设" }));
    const saved = vi.mocked(imagePresetsIpc.save).mock.calls[1][0];
    expect(saved).toEqual({
      ...emptyPresets("B", "轮播图"),
      titlePic: { maxBytes: 102400 },
    });
    await user.click(screen.getByRole("tab", { name: "常规设置" }));
    await act(async () => retry.resolve(saved));
    await user.click(screen.getByRole("tab", { name: "图片预设" }));
    expect(screen.getByRole("button", { name: "保存图片预设" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("TitlePic 体积上限（KiB）")).toHaveValue(100);
    expect(imagePresetsIpc.save).toHaveBeenCalledTimes(2);
    expect(imagePresetsIpc.list).toHaveBeenCalledTimes(1);
    expect(systemService.healthCheck).toHaveBeenCalledTimes(1);
    router.dispose();
  });
  it("服务检查失败切换标签后仍显示错误，关于应用使用前端版本", async () => {
    vi.mocked(systemService.healthCheck).mockRejectedValueOnce(
      new Error("数据库不可用"),
    );
    const router = createMemoryRouter(routes, {
      initialEntries: ["/settings"],
    });
    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    await userEvent.click(await screen.findByRole("tab", { name: "服务连接" }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("tabpanel", { name: "服务连接" })).getByRole(
          "status",
        ),
      ).toHaveTextContent("数据库不可用"),
    );
    await userEvent.click(screen.getByRole("tab", { name: "关于应用" }));
    expect(
      screen.getByRole("tabpanel", { name: "关于应用" }),
    ).toHaveTextContent("v0.1.0 · 前端版本");
    await userEvent.click(screen.getByRole("tab", { name: "服务连接" }));
    expect(
      within(screen.getByRole("tabpanel", { name: "服务连接" })).getByRole(
        "status",
      ),
    ).toHaveTextContent("数据库不可用");
    expect(systemService.healthCheck).toHaveBeenCalledTimes(1);
    router.dispose();
  });
  it("未知路由回到工作台", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/missing"] });
    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/dashboard"),
    );
    router.dispose();
  });
  it("Jotai 主题和导航持久化，编辑状态由 atom 派生", () => {
    const store = createStore();
    store.set(themeAtom, "dark");
    store.set(sidebarOpenAtom, false);
    store.set(editorDirtyAtom, true);
    expect(localStorage.getItem("pressdock.theme")).toBe('"dark"');
    expect(localStorage.getItem("pressdock.sidebar")).toBe("false");
    expect(store.get(editorStatusAtom)).toBe("有未保存修改");
    store.set(editorDirtyAtom, false);
    expect(store.get(editorStatusAtom)).toBe("已保存");
    render(
      <Provider store={store}>
        <div>状态已就绪</div>
      </Provider>,
    );
    expect(screen.getByText("状态已就绪")).toBeInTheDocument();
  });
});
