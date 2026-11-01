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

describe("IPC 字符串错误", () => {
  it.each([
    "Command ai_suggest_pagination not allowed by ACL",
    "ai_suggest_pagination not allowed on any window/webview/URL context",
    "ai_suggest_pagination not allowed. Permissions associated with this command: allow-ai-suggest-pagination",
  ])("权限拒绝转换为中文提示：%s", async (message) => {
    vi.mocked(invoke).mockRejectedValueOnce(message);
    await expect(
      invokeCommand("ai_suggest_pagination", z.unknown()),
    ).rejects.toMatchObject({
      code: "IPC_PERMISSION_DENIED",
      message: "当前应用未开放此操作的调用权限，请更新应用后重试",
    });
  });
  it.each([
    "Command ai_suggest_pagination not found",
    "unknown command ai_suggest_pagination",
  ])("命令不可用转换为中文提示：%s", async (message) => {
    vi.mocked(invoke).mockRejectedValueOnce(message);
    await expect(
      invokeCommand("ai_suggest_pagination", z.unknown()),
    ).rejects.toMatchObject({
      code: "IPC_COMMAND_UNAVAILABLE",
      message: "当前应用版本不支持此操作，请更新应用后重试",
    });
  });
  it("未知字符串不回显原始错误或敏感信息", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("演示内部错误 secret=demo-only");
    await expect(
      invokeCommand("ai_suggest_pagination", z.unknown()),
    ).rejects.toMatchObject({
      code: "IPC_ERROR",
      message: "本地服务调用失败，请重试",
    });
  });
});
