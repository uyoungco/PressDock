import { invoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";

const errorSchema = z.object({ code: z.string(), message: z.string() });
export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
export const isDesktop = () => isTauri();
let sessionEpoch = 0;
const authExpiredListeners = new Set<() => void>();
const invalidationListeners = new Set<() => void>();
export function invalidateClientRequests() {
  sessionEpoch += 1;
  invalidationListeners.forEach((listener) => listener());
}
export function onClientInvalidated(listener: () => void) {
  invalidationListeners.add(listener);
  return () => {
    invalidationListeners.delete(listener);
  };
}
export function onAuthenticationExpired(listener: () => void) {
  authExpiredListeners.add(listener);
  return () => {
    authExpiredListeners.delete(listener);
  };
}

export async function invokeCommand<T>(
  command: string,
  schema: z.ZodType<T>,
  args?: Record<string, unknown>,
): Promise<T> {
  const epoch = sessionEpoch;
  try {
    const result = await invoke<unknown>(command, args);
    if (epoch !== sessionEpoch)
      throw new ServiceError("SESSION_CHANGED", "登录状态已变化，请重试");
    return schema.parse(result);
  } catch (error: unknown) {
    if (epoch !== sessionEpoch)
      throw new ServiceError("SESSION_CHANGED", "登录状态已变化，请重试");
    const parsed = errorSchema.safeParse(error);
    if (parsed.success) {
      if (parsed.data.code === "AUTH_EXPIRED")
        authExpiredListeners.forEach((listener) => listener());
      throw new ServiceError(parsed.data.code, parsed.data.message);
    }
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(
      "IPC_ERROR",
      error instanceof Error ? error.message : "本地服务调用失败，请重试",
    );
  }
}
