import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { Provider, createStore } from "jotai";
import { AppProviders } from "@/app/providers";
import { routes } from "@/app/router";
import { themeAtom } from "@/atoms/theme";
import { sidebarOpenAtom } from "@/atoms/navigation";
import { editorDirtyAtom, editorStatusAtom } from "@/atoms/editor";
import { cmsIpc } from "@/services/tauri/cms";
import { authService } from "@/features/auth/service";
import { chooseOption } from "./select-helpers";

vi.mock("@/services/tauri/cms", () => ({
  cmsIpc: {
    restore: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    channels: vi.fn(async () => []),
  },
}));
vi.mock("@/services/tauri/image-presets", () => ({
  imagePresetsIpc: { list: vi.fn(async () => []) },
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
  authService.useLoginForm();
  vi.mocked(cmsIpc.restore).mockResolvedValue({
    user: { userId: 6, nickname: "editor", roles: ["admin"], perms: ["admin"] },
    persistent: true,
  });
});

describe("工作区", () => {
  it("文章状态下拉显示中文并筛选列表，主题选择继续持久化", async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ["/articles"],
    });
    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    await screen.findByRole("heading", { name: "文章管理" }, { timeout: 5000 });
    expect(
      await screen.findByText("城市更新，让老街区焕发新活力"),
    ).toBeInTheDocument();
    await chooseOption(screen.getByLabelText("筛选文章状态"), "草稿");
    expect(screen.getByLabelText("筛选文章状态")).toHaveTextContent("草稿");
    expect(screen.getByText("共 1 篇")).toBeInTheDocument();
    await chooseOption(screen.getByLabelText("筛选文章状态"), "全部状态");
    expect(screen.getByText("共 4 篇")).toBeInTheDocument();
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
    expect(
      await screen.findByText("Rust 与 SQLite 已就绪"),
    ).toBeInTheDocument();
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
