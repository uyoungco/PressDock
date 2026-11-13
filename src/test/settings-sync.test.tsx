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
import { syncMessage } from "@/features/settings-sync/service";
import { invalidateClientRequests } from "@/services/tauri/client";
import { readySyncStatus } from "./settings-sync-fixtures";
import { deferred } from "./cms-fixtures";
import { settingsActivity } from "@/features/settings-sync/activity";
import { harvestSettingsService } from "@/features/import/settings-service";
import { useSettingsDraft } from "@/features/settings/mobile-state";
vi.mock("@/services/tauri/settings-sync", () => ({
  settingsSyncIpc: {
    start: vi.fn(),
    manual: vi.fn(),
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
  vi.mocked(settingsSyncIpc.manual).mockResolvedValue({
    ...readySyncStatus,
    readRequests: 2,
    successfulReads: 2,
  });
});
it("协议不匹配保留修改，允许手动同步，不显示丢弃式恢复或直接补传", async () => {
  vi.mocked(settingsSyncIpc.start).mockResolvedValueOnce({
    ...readySyncStatus,
    phase: "protocolMismatch",
    pending: 2,
    lastError: "UNSUPPORTED_VERSION",
  });
  render(
    <ConfigBoundary>
      <ConfigSyncStatus />
    </ConfigBoundary>,
  );
  expect(
    (await screen.findAllByText(/配置同步协议不兼容，已暂停上报/)).length,
  ).toBeGreaterThan(0);
  expect(
    screen.queryByRole("button", { name: "恢复同步" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "立即补传" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "手动同步" })[0]);
  await waitFor(() => expect(settingsSyncIpc.manual).toHaveBeenCalledOnce());
  expect(await screen.findByText("已同步最新配置")).toBeVisible();
});
it("旧协议冻结操作保留既有副本恢复路径", () => {
  expect(
    syncMessage({
      ...readySyncStatus,
      phase: "failedValidation",
      lastError: "UNSUPPORTED_VERSION",
    }),
  ).toContain("旧版待传修改不能直接重放");
});
it("缓存读取失败可显式重试，重试期间保留工作区和未保存输入", async () => {
  const retry = deferred<typeof readySyncStatus>();
  vi.mocked(settingsSyncIpc.start).mockResolvedValueOnce({
    ...readySyncStatus,
    phase: "cache",
    usingCache: true,
    successfulReads: 0,
    lastError: "CMS_TIMEOUT",
  });
  vi.mocked(settingsSyncIpc.manual).mockReturnValueOnce(retry.promise);
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
  fireEvent.click(screen.getByRole("button", { name: "手动同步" }));
  expect(screen.getByRole("textbox", { name: "未保存编辑" })).toBe(input);
  expect(input).toHaveValue("尚未保存的修改");
  expect(screen.getByRole("button", { name: "同步中…" })).toBeDisabled();
  await waitFor(() => expect(settingsSyncIpc.manual).toHaveBeenCalledOnce());
  fireEvent(window, new Event("online"));
  fireEvent(window, new Event("focus"));
  expect(settingsSyncIpc.start).toHaveBeenCalledOnce();
  await act(async () => retry.resolve(readySyncStatus));
  expect(
    screen.queryByRole("button", { name: "手动同步" }),
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

it("通知和系统设置共享手动同步任务，成功后仍可再次同步", async () => {
  const request = deferred<typeof readySyncStatus>();
  vi.mocked(settingsSyncIpc.start).mockResolvedValueOnce({
    ...readySyncStatus,
    usingCache: true,
  });
  vi.mocked(settingsSyncIpc.manual).mockReturnValueOnce(request.promise);
  render(
    <ConfigBoundary>
      <ConfigSyncStatus />
    </ConfigBoundary>,
  );
  const buttons = await screen.findAllByRole("button", { name: "手动同步" });
  expect(buttons).toHaveLength(2);
  fireEvent.click(buttons[0]);
  fireEvent.click(buttons[1]);
  expect(
    screen
      .getAllByRole("button", { name: "同步中…" })
      .every((button) => button.hasAttribute("disabled")),
  ).toBe(true);
  await waitFor(() => expect(settingsSyncIpc.manual).toHaveBeenCalledOnce());
  await act(async () =>
    request.resolve({
      ...readySyncStatus,
      readRequests: 2,
      successfulReads: 2,
    }),
  );
  expect(screen.getByText("已同步最新配置")).toBeVisible();
  expect(screen.getAllByRole("button", { name: "手动同步" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "手动同步" }));
  await waitFor(() => expect(settingsSyncIpc.manual).toHaveBeenCalledTimes(2));
});

function SettingsEditor({ dirty = false, busy = false }) {
  useSettingsDraft("test-editor", dirty, busy);
  return <input aria-label="设置输入" defaultValue="保留输入" />;
}

it("共享编辑保护拦截顶部入口，表单卸载后释放状态", async () => {
  vi.mocked(settingsSyncIpc.start).mockResolvedValue({
    ...readySyncStatus,
    usingCache: true,
  });
  const view = render(
    <ConfigBoundary>
      <SettingsEditor dirty />
    </ConfigBoundary>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "手动同步" }));
  expect(await screen.findByText("请先保存或取消编辑")).toBeVisible();
  expect(settingsSyncIpc.manual).not.toHaveBeenCalled();
  view.rerender(
    <ConfigBoundary>
      <SettingsEditor busy />
    </ConfigBoundary>,
  );
  fireEvent.click(screen.getByRole("button", { name: "手动同步" }));
  expect(
    await screen.findByText("设置正在处理，请等待完成后再同步"),
  ).toBeVisible();
  view.rerender(
    <ConfigBoundary>
      <ConfigSyncStatus />
    </ConfigBoundary>,
  );
  fireEvent.click(screen.getAllByRole("button", { name: "手动同步" })[0]);
  await waitFor(() => expect(settingsSyncIpc.manual).toHaveBeenCalledOnce());
});

it("同步失败保留配置、输入和更新版本，仍有待传时明确显示部分完成", async () => {
  await settingsSyncService.start();
  const revision = settingsActivity.getSnapshot().revision;
  vi.mocked(settingsSyncIpc.manual).mockResolvedValueOnce({
    ...readySyncStatus,
    usingCache: true,
    lastError: "SYNC_NETWORK",
  });
  render(
    <>
      <ConfigSyncStatus />
      <input aria-label="稿件草稿" defaultValue="未保存正文" />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "手动同步" }));
  expect(
    await screen.findByText("正在使用上次缓存，本次未能读取最新配置"),
  ).toBeVisible();
  expect(settingsActivity.getSnapshot().revision).toBe(revision);
  expect(screen.getByLabelText("稿件草稿")).toHaveValue("未保存正文");
  vi.mocked(settingsSyncIpc.manual).mockResolvedValueOnce({
    ...readySyncStatus,
    readRequests: 3,
    successfulReads: 2,
    pending: 2,
    phase: "pending",
  });
  fireEvent.click(screen.getByRole("button", { name: "手动同步" }));
  expect(
    await screen.findByText("已更新云端配置，仍有 2 项修改待上报"),
  ).toBeVisible();
  expect(settingsActivity.getSnapshot().revision).toBe(revision + 1);
});

it("同步期间的旧状态响应不能覆盖同步结果", async () => {
  await settingsSyncService.start();
  const oldStatus = deferred<typeof readySyncStatus>();
  vi.mocked(settingsSyncIpc.status).mockReturnValueOnce(oldStatus.promise);
  const polling = settingsSyncService.refresh();
  await settingsSyncService.manual();
  await oldStatus.resolve({ ...readySyncStatus, usingCache: true });
  await polling;
  expect(settingsSyncService.getSnapshot().status?.successfulReads).toBe(2);
  expect(settingsSyncService.getSnapshot().status?.usingCache).toBe(false);
});

it("换号后丢弃旧手动同步响应及刷新信号", async () => {
  await settingsSyncService.start();
  const request = deferred<typeof readySyncStatus>();
  vi.mocked(settingsSyncIpc.manual).mockReturnValueOnce(request.promise);
  const task = settingsSyncService.manual();
  await waitFor(() => expect(settingsSyncIpc.manual).toHaveBeenCalledOnce());
  invalidateClientRequests();
  await settingsSyncService.start();
  const revision = settingsActivity.getSnapshot().revision;
  await request.resolve({
    ...readySyncStatus,
    readRequests: 4,
    successfulReads: 4,
  });
  await task;
  expect(settingsSyncService.getSnapshot().status?.successfulReads).toBe(1);
  expect(settingsActivity.getSnapshot().revision).toBe(revision);
  expect(settingsActivity.getSnapshot().synchronizing).toBe(false);
});

it.each([
  "demo",
  "waitingAuth",
  "failedValidation",
  "restartRequired",
] as const)("%s 状态禁用手动同步", async (phase) => {
  vi.mocked(settingsSyncIpc.start).mockResolvedValueOnce({
    ...readySyncStatus,
    phase,
  });
  await settingsSyncService.start();
  render(<ConfigSyncStatus />);
  expect(screen.getByRole("button", { name: "手动同步" })).toBeDisabled();
  await settingsSyncService.manual();
  expect(settingsSyncIpc.manual).not.toHaveBeenCalled();
});

it("采集设置补存失败中止同步并释放操作锁", async () => {
  await settingsSyncService.start();
  const flush = vi
    .spyOn(harvestSettingsService, "flush")
    .mockRejectedValueOnce(new Error("演示：采集设置写入失败"));
  await settingsSyncService.manual();
  expect(settingsSyncService.getSnapshot().error).toContain("采集设置写入失败");
  expect(settingsSyncIpc.manual).not.toHaveBeenCalled();
  expect(settingsActivity.getSnapshot().synchronizing).toBe(false);
  flush.mockRestore();
});
