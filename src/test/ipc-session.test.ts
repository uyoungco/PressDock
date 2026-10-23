import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";
import {
  invalidateClientRequests,
  invokeCommand,
  onAuthenticationExpired,
} from "@/services/tauri/client";
import { deferred } from "./cms-fixtures";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));

describe("IPC 会话边界", () => {
  it("401 对应统一失效通知，403 不退出", async () => {
    const expired = vi.fn();
    const unsubscribe = onAuthenticationExpired(expired);
    vi.mocked(invoke).mockRejectedValueOnce({
      code: "CMS_FORBIDDEN",
      message: "无权限",
    });
    await expect(invokeCommand("test", z.string())).rejects.toMatchObject({
      code: "CMS_FORBIDDEN",
    });
    expect(expired).not.toHaveBeenCalled();
    vi.mocked(invoke).mockRejectedValueOnce({
      code: "AUTH_EXPIRED",
      message: "请重新登录",
    });
    await expect(invokeCommand("test", z.string())).rejects.toMatchObject({
      code: "AUTH_EXPIRED",
    });
    expect(expired).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
  it("会话切换后的旧成功和旧失效响应均不影响当前会话", async () => {
    const expired = vi.fn();
    const unsubscribe = onAuthenticationExpired(expired);
    const oldSuccess = deferred<unknown>();
    const oldFailure = deferred<unknown>();
    vi.mocked(invoke)
      .mockReturnValueOnce(oldSuccess.promise)
      .mockReturnValueOnce(oldFailure.promise);
    const success = invokeCommand("test", z.string());
    const failure = invokeCommand("test", z.string());
    const checks = [
      expect(success).rejects.toMatchObject({ code: "SESSION_CHANGED" }),
      expect(failure).rejects.toMatchObject({ code: "SESSION_CHANGED" }),
    ];
    invalidateClientRequests();
    oldSuccess.resolve("旧数据");
    oldFailure.reject(
      Object.assign(new Error("旧会话过期"), { code: "AUTH_EXPIRED" }),
    );
    await Promise.all(checks);
    expect(expired).not.toHaveBeenCalled();
    unsubscribe();
  });
});
