import { beforeEach, expect, it, vi } from "vitest";
import { imagesIpc } from "@/services/tauri/images";
import { invalidateClientRequests } from "@/services/tauri/client";
import { imageService } from "@/features/images/service";
import {
  imagePresetSchema,
  type ImageOutput,
  type ImageProcessOptions,
} from "@/features/images/model";

vi.mock("@/services/tauri/images", () => ({
  imagesIpc: {
    inspect: vi.fn(),
    process: vi.fn(),
    cancel: vi.fn().mockResolvedValue(null),
    export: vi.fn(),
  },
}));
const image = new File(["original"], "photo.png", { type: "image/png" });
const options: ImageProcessOptions = {
  crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
  size: { width: 750, height: 750 },
  format: "jpeg",
  maxBytes: 5000,
  quality: 90,
};
function output(): ImageOutput {
  return {
    width: 750,
    height: 750,
    format: "jpeg",
    mimeType: "image/jpeg",
    byteSize: 3,
    dataBase64: "AQID",
    quality: 85,
    lossy: true,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(imagesIpc.process).mockResolvedValue(output());
  vi.mocked(imagesIpc.cancel).mockResolvedValue(null);
});

it("使用原始字节和规范化裁剪参数，返回真实 File 与精确元信息", async () => {
  const { result, quality } = await imageService.process(image, options, {
    format: "jpeg",
    size: options.size,
    maxBytes: 5000,
  });
  expect(imagesIpc.process).toHaveBeenCalledWith(
    expect.objectContaining({
      ...options,
      input: { dataBase64: btoa("original"), mimeType: "image/png" },
    }),
  );
  expect(result.file.name).toBe("photo-processed.jpg");
  expect(result.file.type).toBe("image/jpeg");
  expect(result.file.size).toBe(3);
  expect(result.byteSize).toBe(3);
  expect(quality).toBe(85);
  expect(image.size).toBe(8);
});

it("预设不匹配和非法预设在调用 IPC 前被拒绝", () => {
  for (const preset of [
    { format: "png" as const },
    { size: { width: 280, height: 124 } },
    { maxBytes: 1 },
  ]) {
    expect(() => imageService.process(image, options, preset)).toThrow("预设");
  }
  expect(
    imagePresetSchema.safeParse({ size: { width: 6000, height: 6000 } })
      .success,
  ).toBe(false);
  expect(imagePresetSchema.safeParse({ maxBytes: 0 }).success).toBe(false);
  expect(imagesIpc.process).not.toHaveBeenCalled();
});

it("拒绝体积、尺寸、格式或字节计数不符的结果", async () => {
  for (const mismatch of [
    { width: 749 },
    { byteSize: 100 },
    { format: "png" as const },
    { mimeType: "image/png" as const },
  ]) {
    vi.mocked(imagesIpc.process).mockResolvedValueOnce({
      ...output(),
      ...mismatch,
    });
    await expect(imageService.process(image, options)).rejects.toThrow(
      "不符合",
    );
  }
  await expect(
    imageService.process(image, { ...options, maxBytes: 2 }),
  ).rejects.toThrow("不符合");
});

it("空文件和过大的源文件不进入原生处理", async () => {
  await expect(imageService.process(new Blob(), options)).rejects.toThrow(
    "20 MiB",
  );
  const huge = new Blob(["x"]);
  Object.defineProperty(huge, "size", { value: 20 * 1024 * 1024 + 1 });
  await expect(imageService.process(huge, options)).rejects.toThrow("20 MiB");
  expect(imagesIpc.process).not.toHaveBeenCalled();
});

it("取消或会话失效时取消原生任务并丢弃延迟结果", async () => {
  for (const invalidate of [false, true]) {
    let release!: (value: ImageOutput) => void;
    let started!: () => void;
    const called = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(imagesIpc.process).mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const controller = new AbortController();
    const task = imageService.process(image, options, {}, controller.signal);
    await called;
    if (invalidate) invalidateClientRequests();
    else controller.abort();
    release(output());
    await expect(task).rejects.toMatchObject({ code: "IMAGE_CANCELLED" });
  }
  expect(imagesIpc.cancel).toHaveBeenCalledTimes(2);
});

it("导出透传取消结果，失败不伪装为保存成功", async () => {
  const { result } = await imageService.process(image, options);
  vi.mocked(imagesIpc.export).mockResolvedValueOnce({
    saved: false,
    fileName: null,
  });
  expect(await imageService.export(result)).toEqual({
    saved: false,
    fileName: null,
  });
  vi.mocked(imagesIpc.export).mockRejectedValueOnce(new Error("文件已存在"));
  await expect(imageService.export(result)).rejects.toThrow("文件已存在");
});
