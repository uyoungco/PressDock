import { z } from "zod";
import { invokeCommand } from "./client";

// 启动命令不接受路径或 URL，避免把第三方窗口变成任意页面启动器。
export const photoCraftIpc = {
  open: (): Promise<null> => invokeCommand("open_photocraft", z.null()),
};
