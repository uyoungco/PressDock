import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { routes } from "@/app/router";
import { AppProviders } from "@/app/providers";
import { cmsIpc } from "@/services/tauri/cms";
import { authService, safeReturnPath } from "@/features/auth/service";
import { isDesktop } from "@/services/tauri/client";
import { invokeCommand } from "@/services/tauri/client";
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { editorBuffers } from "@/features/editor/buffer";
import { deferred, session, materialPage } from "./cms-fixtures";
import { channelQueryMemory } from "@/features/channels/query-memory";
import {
  channelEditBuffers,
  recordInput,
} from "@/features/channels/edit-buffer";
import { material } from "./cms-fixtures";

vi.mock("@/services/tauri/cms", () => ({
  cmsIpc: {
    restore: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    channels: vi.fn(),
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
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));
vi.mock("@/services/tauri/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/tauri/client")>()),
  isDesktop: vi.fn(() => true),
}));
vi.mock("@/services/cms", async () => ({
  articleService: new (await import("@/services/cms/mock")).MockCmsAdapter(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  authService.useLoginForm();
  editorBuffers.clear();
  channelQueryMemory.clear();
  channelEditBuffers.clear();
  vi.mocked(isDesktop).mockReturnValue(true);
  vi.mocked(cmsIpc.restore).mockResolvedValue(null);
  vi.mocked(cmsIpc.login).mockResolvedValue(session);
  vi.mocked(cmsIpc.logout).mockResolvedValue({
    remoteSucceeded: true,
    credentialsCleared: true,
  });
});
function renderRoute(path = "/login") {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

describe("登录和工作区认证", () => {
  it("未登录保护整个工作区并保留完整目标查询", async () => {
    const router = renderRoute("/channels?channel=KOOK&publishdate=2026-10-23");
    await screen.findByRole("heading", { name: "登录 PressDock" });
    expect(
      new URLSearchParams(router.state.location.search).get("redirect"),
    ).toBe("/channels?channel=KOOK&publishdate=2026-10-23");
    expect(cmsIpc.list).not.toHaveBeenCalled();
    router.dispose();
  });
  it("恢复完成前不渲染工作区，网络异常可重试且不退出", async () => {
    const pending = deferred<typeof session | null>();
    vi.mocked(cmsIpc.restore).mockReturnValueOnce(pending.promise);
    const router = renderRoute("/dashboard");
    expect(screen.getByText("正在验证登录状态…")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "工作台" }),
    ).not.toBeInTheDocument();
    await act(async () => pending.reject(new Error("网络不可用")));
    expect(await screen.findByText("网络不可用")).toBeInTheDocument();
    expect(cmsIpc.logout).not.toHaveBeenCalled();
    vi.mocked(cmsIpc.restore).mockResolvedValue(session);
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(
      await screen.findByRole("heading", { name: "工作台" }),
    ).toBeInTheDocument();
    router.dispose();
  });
  it("账号密码必填，密码显隐，Enter 提交不裁剪密码", async () => {
    const router = renderRoute("/login?redirect=/articles");
    await screen.findByRole("heading", { name: "登录 PressDock" });
    await userEvent.click(screen.getByRole("button", { name: "登录" }));
    expect(screen.getByText("请输入用户名")).toBeInTheDocument();
    expect(screen.getByText("请输入密码")).toBeInTheDocument();
    expect(cmsIpc.login).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("用户名"), " editor ");
    await userEvent.type(
      screen.getByLabelText("密码", { exact: true }),
      " secret ",
    );
    await userEvent.click(screen.getByRole("button", { name: "显示密码" }));
    expect(screen.getByLabelText("密码", { exact: true })).toHaveAttribute(
      "type",
      "text",
    );
    await userEvent.type(
      screen.getByLabelText("密码", { exact: true }),
      "{Enter}",
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/articles"),
    );
    expect(cmsIpc.login).toHaveBeenCalledExactlyOnceWith({
      username: "editor",
      password: " secret ",
    });
    expect(
      await screen.findByRole("heading", { name: "文章管理" }),
    ).toBeInTheDocument();
    expect(Object.keys(localStorage)).not.toContain("accessToken");
    router.dispose();
  });
  it("错误密码展示服务提示，提交期间阻止重复", async () => {
    const pending = deferred<typeof session>();
    vi.mocked(cmsIpc.login).mockReturnValue(pending.promise);
    const router = renderRoute();
    await screen.findByLabelText("用户名");
    await userEvent.type(screen.getByLabelText("用户名"), "editor");
    await userEvent.type(
      screen.getByLabelText("密码", { exact: true }),
      "wrong",
    );
    await userEvent.dblClick(screen.getByRole("button", { name: "登录" }));
    expect(cmsIpc.login).toHaveBeenCalledTimes(1);
    await act(async () => pending.reject(new Error("密码错误")));
    expect(await screen.findByText("密码错误")).toBeInTheDocument();
    expect(screen.getByLabelText("密码", { exact: true })).toHaveValue("");
    router.dispose();
  });
  it("浏览器仅预览登录，不能进入工作区", async () => {
    vi.mocked(isDesktop).mockReturnValue(false);
    const router = renderRoute("/dashboard");
    expect(await screen.findByText(/当前为浏览器预览/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录" })).toBeDisabled();
    expect(cmsIpc.restore).not.toHaveBeenCalled();
    router.dispose();
  });
  it("取消退出无请求，远程退出失败仍离开工作区", async () => {
    vi.mocked(cmsIpc.restore).mockResolvedValue(session);
    vi.mocked(cmsIpc.logout).mockResolvedValue({
      remoteSucceeded: false,
      credentialsCleared: true,
    });
    const router = renderRoute("/dashboard");
    await userEvent.click(
      await screen.findByRole("button", { name: "账号菜单" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "退出登录" }));
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(cmsIpc.logout).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "账号菜单" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "退出登录" }));
    await userEvent.click(screen.getByRole("button", { name: "确认退出" }));
    expect(
      await screen.findByRole("heading", { name: "登录 PressDock" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("已退出本地会话，后台退出请求未成功。"),
    ).toBeInTheDocument();
    router.dispose();
  });
  it("退出后的旧恢复结果不重新登录，编辑缓冲按用户清理", async () => {
    const pending = deferred<typeof session | null>();
    vi.mocked(cmsIpc.restore).mockReturnValue(pending.promise);
    const restoring = authService.restore();
    editorBuffers.set(6, "a", { title: "未保存", content: "正文" });
    await authService.logout();
    pending.resolve(session);
    await restoring;
    expect(authService.getSnapshot().status).toBe("anonymous");
    expect(editorBuffers.get(6, "a")).toBeUndefined();
  });
  it("会话失效保留未保存草稿，同账号重新登录后恢复", async () => {
    vi.mocked(cmsIpc.restore).mockResolvedValue(session);
    const router = renderRoute("/editor/demo-1");
    const title = await screen.findByLabelText("文章标题");
    await userEvent.clear(title);
    await userEvent.type(title, "尚未保存的稿件");
    vi.mocked(invoke).mockRejectedValueOnce({
      code: "AUTH_EXPIRED",
      message: "登录失效",
    });
    await act(async () => {
      await expect(invokeCommand("test", z.string())).rejects.toMatchObject({
        code: "AUTH_EXPIRED",
      });
    });
    await screen.findByRole("heading", { name: "登录 PressDock" });
    expect(editorBuffers.get(6, "demo-1")?.title).toBe("尚未保存的稿件");
    await userEvent.type(screen.getByLabelText("用户名"), "editor");
    await userEvent.type(
      screen.getByLabelText("密码", { exact: true }),
      "secret{Enter}",
    );
    expect(await screen.findByLabelText("文章标题")).toHaveValue(
      "尚未保存的稿件",
    );
    router.dispose();
  });
  it("回跳只允许完整站内业务路由", () => {
    expect(safeReturnPath("/channels?channel=KOOK&current=2")).toBe(
      "/channels?channel=KOOK&current=2",
    );
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/login",
      "/%2f%2fevil.example",
      "/editor/%5cevil",
      "/channels\n",
    ])
      expect(safeReturnPath(bad)).toBe("/dashboard");
  });

  it("素材排序在失效后取消，同账号登录重新查询服务端顺序", async () => {
    vi.mocked(cmsIpc.restore).mockResolvedValue(session);
    vi.mocked(cmsIpc.channels).mockResolvedValue([
      { channel: "KOOK", subchannels: ["轮播图"] },
    ]);
    vi.mocked(cmsIpc.list).mockResolvedValue(materialPage(2));
    const router = renderRoute(
      "/channels?channel=KOOK&subchannel=轮播图&publishdate=2026-10-21",
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "开始排序" }),
    );
    await userEvent.click(screen.getByLabelText("下移素材 1"));
    vi.mocked(invoke).mockRejectedValueOnce({
      code: "AUTH_EXPIRED",
      message: "登录失效",
    });
    await act(async () => {
      await invokeCommand("expire", z.string()).catch(() => undefined);
    });
    await screen.findByRole("heading", { name: "登录 PressDock" });
    await userEvent.type(screen.getByLabelText("用户名"), "editor");
    await userEvent.type(
      screen.getByLabelText("密码", { exact: true }),
      "secret{Enter}",
    );
    await screen.findByRole("button", { name: "开始排序" });
    await waitFor(() =>
      expect(
        [...document.querySelectorAll("tbody tr")].map((e) =>
          e.getAttribute("data-material-id"),
        ),
      ).toEqual(["1", "2"]),
    );
    expect(cmsIpc.list).toHaveBeenCalledTimes(2);
    expect(cmsIpc.order).not.toHaveBeenCalled();
    router.dispose();
  });

  it("素材表单在失效后同账号恢复，显式退出清理", async () => {
    vi.mocked(cmsIpc.restore).mockResolvedValue(session);
    vi.mocked(cmsIpc.channels).mockResolvedValue([]);
    vi.mocked(cmsIpc.list).mockResolvedValue(materialPage());
    const router = renderRoute("/channels?current=1&pagesize=30");
    await userEvent.click(await screen.findByRole("button", { name: "新增" }));
    await userEvent.type(
      screen.getByLabelText("* Title", { exact: true }),
      "内存中的素材表单",
    );
    vi.mocked(invoke).mockRejectedValueOnce({
      code: "AUTH_EXPIRED",
      message: "登录失效",
    });
    await act(async () => {
      await invokeCommand("expire", z.string()).catch(() => undefined);
    });
    await screen.findByRole("heading", { name: "登录 PressDock" });
    await userEvent.type(screen.getByLabelText("用户名"), "editor");
    await userEvent.type(
      screen.getByLabelText("密码", { exact: true }),
      "secret{Enter}",
    );
    expect(
      await screen.findByLabelText("* Title", { exact: true }),
    ).toHaveValue("内存中的素材表单");
    await act(async () => {
      await authService.logout();
    });
    await screen.findByRole("heading", { name: "登录 PressDock" });
    expect(channelEditBuffers.get(6)).toBeNull();
    router.dispose();
  });

  it("筛选记忆跨失效后同账号登录保留，更换账号或显式退出清空", async () => {
    await authService.login({ username: "editor", password: "secret" });
    const query = {
      channel: "KOOK",
      subchannel: "轮播图",
      publishdate: "2026-10-23",
      current: 3,
      pagesize: 20 as const,
    };
    channelQueryMemory.remember(query);
    channelEditBuffers.set(6, {
      base: material(),
      input: { ...recordInput(material()), title: "未保存的渠道素材" },
    });
    vi.mocked(invoke).mockRejectedValueOnce({
      code: "AUTH_EXPIRED",
      message: "登录失效",
    });
    await expect(invokeCommand("test", z.string())).rejects.toMatchObject({
      code: "AUTH_EXPIRED",
    });
    expect(channelQueryMemory.read()).toEqual(query);
    expect(channelEditBuffers.get(6)?.input.title).toBe("未保存的渠道素材");
    await authService.login({ username: "editor", password: "secret" });
    expect(channelQueryMemory.read()).toEqual(query);
    vi.mocked(cmsIpc.login).mockResolvedValue({
      ...session,
      user: { ...session.user, userId: 7 },
    });
    await authService.login({ username: "another", password: "secret" });
    expect(channelQueryMemory.read()).toBeNull();
    expect(channelEditBuffers.get(6)).toBeNull();
    channelQueryMemory.remember(query);
    channelEditBuffers.set(7, { base: null, input: recordInput(material()) });
    await authService.logout();
    expect(channelQueryMemory.read()).toBeNull();
    expect(channelEditBuffers.get(7)).toBeNull();
  });
});
