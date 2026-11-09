import { StrictMode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  ConfigBoundary,
  ConfigSyncStatus,
} from "@/features/settings-sync/ConfigBoundary";
import { settingsSyncIpc } from "@/services/tauri/settings-sync";
import { settingsSyncService } from "@/features/settings-sync/service";
import { invalidateClientRequests } from "@/services/tauri/client";
import { readySyncStatus } from "./settings-sync-fixtures";
import { deferred } from "./cms-fixtures";
vi.mock("@/services/tauri/settings-sync", () => ({
  settingsSyncIpc: {
    start: vi.fn(),
    status: vi.fn(),
    wake: vi.fn(async () => null),
    resolve: vi.fn(),
  },
}));
beforeEach(() => {
  invalidateClientRequests();
  vi.clearAllMocks();
  vi.mocked(settingsSyncIpc.start).mockResolvedValue(readySyncStatus);
  vi.mocked(settingsSyncIpc.status).mockResolvedValue(readySyncStatus);
});
it("缓存读取失败可显式重试，重试期间保留工作区和未保存输入", async () => {
  const retry = deferred<typeof readySyncStatus>();
  vi.mocked(settingsSyncIpc.start)
    .mockResolvedValueOnce({
      ...readySyncStatus,
      phase: "cache",
      usingCache: true,
      successfulReads: 0,
      lastError: "CMS_TIMEOUT",
    })
    .mockReturnValueOnce(retry.promise);
  render(
    <ConfigBoundary>
      <input aria-label="未保存编辑" defaultValue="保留的输入" />
    </ConfigBoundary>,
  );
  expect(
    await screen.findByText("云端登录校验超时，正在使用上次缓存"),
  ).toBeVisible();
  const input = screen.getByRole("textbox", { name: "未保存编辑" });
  fireEvent.change(input, { target: { value: "尚未保存的修改" } });
  fireEvent.click(screen.getByRole("button", { name: "重试读取" }));
  expect(screen.getByRole("textbox", { name: "未保存编辑" })).toBe(input);
  expect(input).toHaveValue("尚未保存的修改");
  expect(screen.getByRole("button", { name: "正在重试…" })).toBeDisabled();
  fireEvent(window, new Event("online"));
  fireEvent(window, new Event("focus"));
  expect(settingsSyncIpc.start).toHaveBeenCalledTimes(2);
  expect(settingsSyncIpc.start).toHaveBeenLastCalledWith(true);
  await act(async () => retry.resolve(readySyncStatus));
  expect(
    screen.queryByRole("button", { name: "重试读取" }),
  ).not.toBeInTheDocument();
  expect(input).toHaveValue("尚未保存的修改");
});
it("永久拒绝恢复先确认，保留成功后只提示重启，不再次拉取云端", async () => {
  vi.mocked(settingsSyncIpc.start).mockResolvedValueOnce({
    ...readySyncStatus,
    phase: "failedValidation",
    pending: 2,
    lastError: "ENTITY_DELETED",
  });
  vi.mocked(settingsSyncIpc.resolve).mockResolvedValueOnce({
    ...readySyncStatus,
    ready: false,
    phase: "restartRequired",
    pending: 0,
  });
  render(
    <ConfigBoundary>
      <ConfigSyncStatus />
    </ConfigBoundary>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "恢复同步" }));
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "全部 2 项待传修改和对应密钥",
  );
  expect(settingsSyncIpc.resolve).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "继续保留待传" }));
  expect(settingsSyncIpc.resolve).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "恢复同步" }));
  fireEvent.click(
    screen.getByRole("button", { name: "保留副本，重启后采用云端" }),
  );
  expect(await screen.findByText("待传修改已保留，请重新启动")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "重试读取" }),
  ).not.toBeInTheDocument();
  expect(settingsSyncIpc.resolve).toHaveBeenCalledOnce();
  expect(settingsSyncIpc.start).toHaveBeenCalledOnce();
});

it("恢复副本保存失败时保留确认界面和原队列状态", async () => {
  vi.mocked(settingsSyncIpc.start).mockResolvedValueOnce({
    ...readySyncStatus,
    phase: "failedValidation",
    pending: 1,
  });
  vi.mocked(settingsSyncIpc.resolve).mockRejectedValueOnce(
    new Error("磁盘写入失败"),
  );
  render(
    <ConfigBoundary>
      <ConfigSyncStatus />
    </ConfigBoundary>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "恢复同步" }));
  fireEvent.click(
    screen.getByRole("button", { name: "保留副本，重启后采用云端" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "原待传修改仍然保留",
  );
  expect(settingsSyncService.getSnapshot().status?.pending).toBe(1);
  expect(settingsSyncIpc.start).toHaveBeenCalledOnce();
});
it("首次无缓存失败阻止工作区，只有点击重试再次发起初始化", async () => {
  vi.mocked(settingsSyncIpc.start).mockResolvedValueOnce({
    ...readySyncStatus,
    ready: false,
    phase: "blocked",
    lastError: "SYNC_NETWORK",
  });
  render(
    <ConfigBoundary>
      <div>测试工作区</div>
    </ConfigBoundary>,
  );
  expect(
    await screen.findByText("首次读取全局配置失败，请检查网络后重试。"),
  ).toBeVisible();
  expect(screen.queryByText("测试工作区")).not.toBeInTheDocument();
  expect(settingsSyncIpc.start).toHaveBeenCalledOnce();
  fireEvent(window, new Event("focus"));
  fireEvent(window, new Event("online"));
  expect(settingsSyncIpc.start).toHaveBeenCalledOnce();
  expect(settingsSyncIpc.wake).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "重试读取" }));
  expect(await screen.findByText("测试工作区")).toBeVisible();
  expect(settingsSyncIpc.start).toHaveBeenLastCalledWith(true);
});
it("StrictMode 合并进行中的启动，缓存失败提示仍允许工作区", async () => {
  const pending = deferred<typeof readySyncStatus>();
  vi.mocked(settingsSyncIpc.start).mockReturnValueOnce(pending.promise);
  render(
    <StrictMode>
      <ConfigBoundary>
        <div>缓存工作区</div>
      </ConfigBoundary>
    </StrictMode>,
  );
  expect(settingsSyncIpc.start).toHaveBeenCalledOnce();
  await act(async () =>
    pending.resolve({
      ...readySyncStatus,
      usingCache: true,
      phase: "cache",
      successfulReads: 0,
      lastError: "SYNC_NETWORK",
    }),
  );
  expect(await screen.findByText("缓存工作区")).toBeVisible();
  expect(
    screen.getByText("正在使用上次缓存，本次未能读取最新配置"),
  ).toBeVisible();
});
it("身份改变后丢弃旧初始化响应，新的会话可继续初始化", async () => {
  const old = deferred<typeof readySyncStatus>();
  vi.mocked(settingsSyncIpc.start).mockReturnValueOnce(old.promise);
  const first = settingsSyncService.start();
  invalidateClientRequests();
  const second = settingsSyncService.start();
  await second;
  await old.resolve({ ...readySyncStatus, ready: false, phase: "blocked" });
  await first;
  expect(settingsSyncService.getSnapshot().status?.ready).toBe(true);
  expect(settingsSyncIpc.start).toHaveBeenCalledTimes(2);
});
it("读取状态和网络恢复不会主动调用整份配置读取", async () => {
  render(
    <ConfigBoundary>
      <div>测试工作区</div>
    </ConfigBoundary>,
  );
  await screen.findByText("测试工作区");
  for (let i = 0; i < 3; i++) {
    fireEvent(window, new Event("online"));
    fireEvent(window, new Event("focus"));
    await act(() => settingsSyncService.refresh());
  }
  await waitFor(() => expect(settingsSyncIpc.status).toHaveBeenCalledTimes(3));
  expect(settingsSyncIpc.start).toHaveBeenCalledOnce();
  expect(settingsSyncIpc.wake).toHaveBeenCalledTimes(3);
});
