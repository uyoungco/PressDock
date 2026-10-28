import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HarvestSettings } from "@/features/import/HarvestSettings";
import { importService } from "@/features/import/service";
import { harvestIpc } from "@/services/tauri/harvest";
import { aiService } from "@/features/ai/service";
import { invalidateClientRequests } from "@/services/tauri/client";
import type { HarvestSettings as Settings } from "@/features/import/contracts";
import { aiSettings } from "./ai-fixtures";
import { deferred } from "./cms-fixtures";
import { toast } from "sonner";

vi.mock("@/services/tauri/harvest", () => ({
  harvestIpc: {
    settings: vi.fn(),
    saveSettings: vi.fn(),
    setDeveloperMode: vi.fn(),
    enqueue: vi.fn(),
  },
}));
vi.mock("@/features/ai/service", () => ({ aiService: { load: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const autosave = importService.settingsAutosave;
let persisted: Settings;
beforeEach(() => {
  vi.useFakeTimers();
  invalidateClientRequests();
  vi.resetAllMocks();
  persisted = {
    developerMode: false,
    autoClassify: false,
    autoTags: true,
    autoSummary: true,
    autoOrganize: false,
    autoPaginate: false,
    modelConfigId: null,
    retentionDays: null,
  };
  vi.mocked(harvestIpc.settings).mockImplementation(async () => ({
    ...persisted,
  }));
  vi.mocked(harvestIpc.saveSettings).mockImplementation(async (request) => {
    persisted = { ...request };
    return null;
  });
  vi.mocked(harvestIpc.setDeveloperMode).mockImplementation(async (enabled) => {
    persisted.developerMode = enabled;
    return enabled;
  });
  vi.mocked(aiService.load).mockResolvedValue(aiSettings());
});
afterEach(() => {
  invalidateClientRequests();
  vi.useRealTimers();
});
const tick = (ms = 500) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
async function show() {
  const view = render(
    <StrictMode>
      <HarvestSettings active />
    </StrictMode>,
  );
  await tick(0);
  return view;
}
const changeDays = (value: string) =>
  fireEvent.change(screen.getByLabelText("历史保留时间（天）"), {
    target: { value },
  });

it("首次加载不保存，移除按钮；连续修改在最后一次修改 500 毫秒后合并保存", async () => {
  await show();
  expect(
    screen.queryByRole("button", { name: "保存采集设置" }),
  ).not.toBeInTheDocument();
  await tick();
  expect(harvestIpc.saveSettings).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("AI 判断分类"));
  await tick(400);
  changeDays("30");
  expect(screen.getByRole("status")).toHaveTextContent("待保存");
  await tick(499);
  expect(harvestIpc.saveSettings).not.toHaveBeenCalled();
  await tick(1);
  expect(harvestIpc.saveSettings).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ autoClassify: true, retentionDays: 30 }),
  );
  expect(screen.getByRole("status")).toHaveTextContent("已保存");
  expect(toast.success).not.toHaveBeenCalled();
});

it("改回已保存值取消待保存；保留天数校验暂停整批保存，修正后恢复", async () => {
  await show();
  const checkbox = screen.getByLabelText("AI 判断分类");
  fireEvent.click(checkbox);
  fireEvent.click(checkbox);
  await tick();
  expect(harvestIpc.saveSettings).not.toHaveBeenCalled();
  for (const value of ["0", "36501", "1.5", "abc"]) {
    fireEvent.click(checkbox);
    changeDays(value);
    await tick();
    expect(screen.getByLabelText("历史保留时间（天）")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(harvestIpc.saveSettings).not.toHaveBeenCalled();
  }
  changeDays("36500");
  await tick();
  expect(persisted.retentionDays).toBe(36500);
  changeDays("");
  await tick();
  expect(persisted.retentionDays).toBeNull();
});

it("保存期间继续修改不锁表单，旧结果不覆盖新输入，并串行补存最新值", async () => {
  const pending = deferred<null>();
  vi.mocked(harvestIpc.saveSettings).mockImplementationOnce(async (request) => {
    await pending.promise;
    persisted = { ...request };
    return null;
  });
  await show();
  changeDays("30");
  await tick();
  expect(screen.getByRole("status")).toHaveTextContent("正在保存");
  expect(screen.getByLabelText("AI 判断分类")).toBeEnabled();
  changeDays("60");
  await tick();
  expect(harvestIpc.saveSettings).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending.resolve(null);
  });
  expect(screen.getByLabelText("历史保留时间（天）")).toHaveValue("60");
  expect(harvestIpc.saveSettings).toHaveBeenCalledTimes(2);
  expect(persisted.retentionDays).toBe(60);
});

it("进行中的保存完成后，后续修改仍等待自身的 500 毫秒，改回旧值也会补存", async () => {
  await importService.settings();
  const pending = deferred<null>();
  vi.mocked(harvestIpc.saveSettings).mockImplementationOnce(async (request) => {
    await pending.promise;
    persisted = { ...request };
    return null;
  });
  autosave.updateDays("30");
  await tick();
  autosave.updateDays("");
  pending.resolve(null);
  await tick(499);
  expect(harvestIpc.saveSettings).toHaveBeenCalledTimes(1);
  await tick(1);
  expect(harvestIpc.saveSettings).toHaveBeenCalledTimes(2);
  expect(persisted.retentionDays).toBeNull();
});

it("切换标签和卸载立即补存，重新读取可恢复持久设置", async () => {
  const view = await show();
  changeDays("30");
  view.rerender(<HarvestSettings active={false} />);
  await tick(0);
  expect(persisted.retentionDays).toBe(30);
  view.rerender(<HarvestSettings active />);
  await tick(0);
  changeDays("60");
  view.unmount();
  await tick(0);
  expect(persisted.retentionDays).toBe(60);
  invalidateClientRequests();
  await importService.settings();
  expect(autosave.getSnapshot().days).toBe("60");
});

it("失败保留输入、停止自动重试；点击重试保存最新输入", async () => {
  vi.mocked(harvestIpc.saveSettings).mockRejectedValueOnce(
    new Error("数据库不可用"),
  );
  await show();
  changeDays("30");
  await tick();
  expect(screen.getByRole("alert")).toHaveTextContent("数据库不可用");
  expect(screen.getByLabelText("历史保留时间（天）")).toHaveValue("30");
  await tick(5000);
  expect(harvestIpc.saveSettings).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await tick(0);
  expect(persisted.retentionDays).toBe(30);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("保存失败后离开再返回仍保留表单，重试成功清除错误", async () => {
  const view = await show();
  vi.mocked(harvestIpc.saveSettings).mockRejectedValueOnce(
    new Error("数据库不可用"),
  );
  changeDays("30");
  await tick();
  view.rerender(<HarvestSettings active={false} />);
  await tick(0);
  view.rerender(<HarvestSettings active />);
  await tick(0);
  expect(screen.getByLabelText("历史保留时间（天）")).toHaveValue("30");
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await tick(0);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("模型选择与规则使用同一个防抖批次，读取设置提前补存", async () => {
  await importService.settings();
  autosave.update({ modelConfigId: "model-1", autoOrganize: true });
  await importService.settings();
  expect(harvestIpc.saveSettings).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ modelConfigId: "model-1", autoOrganize: true }),
  );
});

it("开发者模式即时保存，不顺带提交等待防抖的修改，后续完整写入保留最新模式", async () => {
  await importService.settings();
  autosave.updateDays("30");
  await importService.setDeveloperMode(true);
  expect(persisted.developerMode).toBe(true);
  expect(harvestIpc.saveSettings).not.toHaveBeenCalled();
  await tick();
  expect(persisted).toMatchObject({ developerMode: true, retentionDays: 30 });
});

it("完整保存与模式切换串行；模式保存失败不改变勾选或阻止其他设置保存", async () => {
  await importService.settings();
  const pending = deferred<null>();
  vi.mocked(harvestIpc.saveSettings).mockImplementationOnce(async (request) => {
    await pending.promise;
    persisted = { ...request };
    return null;
  });
  autosave.updateDays("30");
  await tick();
  const mode = importService.setDeveloperMode(true);
  expect(harvestIpc.setDeveloperMode).not.toHaveBeenCalled();
  pending.resolve(null);
  await mode;
  expect(persisted).toMatchObject({ developerMode: true, retentionDays: 30 });
  vi.mocked(harvestIpc.setDeveloperMode).mockRejectedValueOnce(
    new Error("模式写入失败"),
  );
  await expect(importService.setDeveloperMode(false)).rejects.toThrow(
    "模式写入失败",
  );
  expect(autosave.getSnapshot().form?.developerMode).toBe(true);
  autosave.updateDays("60");
  await tick();
  expect(persisted).toMatchObject({ developerMode: true, retentionDays: 60 });
});

it("创建采集任务等待补存；保存失败阻止入队", async () => {
  await importService.settings();
  const pending = deferred<null>();
  vi.mocked(harvestIpc.saveSettings).mockReturnValueOnce(pending.promise);
  autosave.updateDays("30");
  const enqueue = importService.enqueue(
    "job",
    "https://baijiahao.baidu.com/s?id=1",
  );
  await tick(0);
  expect(harvestIpc.enqueue).not.toHaveBeenCalled();
  pending.resolve(null);
  await enqueue;
  expect(harvestIpc.enqueue).toHaveBeenCalledTimes(1);
  autosave.updateDays("60");
  vi.mocked(harvestIpc.saveSettings).mockRejectedValueOnce(
    new Error("保存失败"),
  );
  await expect(
    importService.enqueue("next", "https://baijiahao.baidu.com/s?id=2"),
  ).rejects.toThrow("保存失败");
  expect(harvestIpc.enqueue).toHaveBeenCalledTimes(1);
});

it("会话失效取消定时及尚未发出的排队写入，迟到结果不污染下一会话", async () => {
  await importService.settings();
  autosave.updateDays("30");
  invalidateClientRequests();
  await tick();
  expect(harvestIpc.saveSettings).not.toHaveBeenCalled();
  await importService.settings();
  const pending = deferred<boolean>();
  vi.mocked(harvestIpc.setDeveloperMode).mockReturnValueOnce(pending.promise);
  const mode = importService.setDeveloperMode(true);
  const rejectedMode = expect(mode).rejects.toMatchObject({
    code: "SESSION_CHANGED",
  });
  await tick(0);
  autosave.updateDays("60");
  await tick();
  invalidateClientRequests();
  pending.resolve(true);
  await rejectedMode;
  await tick(0);
  expect(harvestIpc.saveSettings).not.toHaveBeenCalled();
  expect(autosave.getSnapshot().form).toBeNull();
});
