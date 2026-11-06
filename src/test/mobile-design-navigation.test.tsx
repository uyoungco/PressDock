import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { Provider } from "jotai";
import { TopBar } from "@/components/layout/TopBar";
import { AccountControls } from "@/components/layout/AccountControls";
import { authService } from "@/features/auth/service";
import { session } from "./cms-fixtures";

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ session }) }));
vi.mock("@/features/auth/service", () => ({
  authService: { logout: vi.fn() },
}));
beforeEach(() => vi.stubEnv("VITE_PRESSDOCK_PLATFORM", "android"));
afterEach(() => vi.unstubAllEnvs());

it("顶栏保留四类 CMS 文章入口，切换时交回原有路由恢复查询", async () => {
  const router = createMemoryRouter(
    [{ path: "*", element: <TopBar onMenu={vi.fn()} /> }],
    { initialEntries: ["/articles/quality?title=保留查询"] },
  );
  render(
    <Provider>
      <RouterProvider router={router} />
    </Provider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "选择文章类别" }));
  expect(screen.getAllByRole("menuitem")).toHaveLength(4);
  await userEvent.click(
    screen.getByRole("menuitem", { name: "二级待审核文章" }),
  );
  expect(router.state.location.pathname).toBe("/articles/review-2");
  expect(
    screen.getByRole("button", { name: "选择文章类别" }),
  ).toHaveTextContent("二级待审核文章");
  router.dispose();
});

it("设置分项的顶栏返回交给设置层级处理", async () => {
  const back = vi.fn();
  window.addEventListener("pressdock-settings-back", back);
  const router = createMemoryRouter(
    [{ path: "*", element: <TopBar onMenu={vi.fn()} /> }],
    { initialEntries: ["/settings?tab=ai-models"] },
  );
  render(
    <Provider>
      <RouterProvider router={router} />
    </Provider>,
  );
  expect(screen.getByRole("heading", { name: "AI 模型" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "返回上一级" }));
  expect(back).toHaveBeenCalledOnce();
  window.removeEventListener("pressdock-settings-back", back);
  router.dispose();
});

it("导航中的退出保留 Android 草稿清理确认，取消不会退出", async () => {
  render(
    <Provider>
      <AccountControls mobile />
    </Provider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "退出登录" }));
  expect(screen.getByRole("dialog", { name: "退出登录？" })).toHaveTextContent(
    "清除此设备尚未提交的素材和文章草稿",
  );
  await userEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(authService.logout).not.toHaveBeenCalled();
});
