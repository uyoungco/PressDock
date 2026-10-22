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

export async function invokeCommand<T>(
  command: string,
  schema: z.ZodType<T>,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return schema.parse(await invoke<unknown>(command, args));
  } catch (error: unknown) {
    const parsed = errorSchema.safeParse(error);
    if (parsed.success)
      throw new ServiceError(parsed.data.code, parsed.data.message);
    throw new ServiceError(
      "IPC_ERROR",
      error instanceof Error ? error.message : "本地服务调用失败，请重试",
    );
  }
}
