import { beforeEach, expect, it, vi } from "vitest";
import { imagePresetsIpc } from "@/services/tauri/image-presets";
import { imagePresetsService } from "@/features/image-presets/service";
import { emptyPresets } from "@/features/image-presets/model";
import { channelService } from "@/features/channels/service";
import type { ImageProcessorResult } from "@/features/images/model";

vi.mock("@/services/tauri/image-presets", () => ({
  imagePresetsIpc: { list: vi.fn(), save: vi.fn() },
}));
vi.mock("@/features/channels/service", () => ({
  channelService: { upload: vi.fn() },
}));
beforeEach(() => {
  vi.resetAllMocks();
});
it("按完整渠道、子渠道及图片字段匹配，每次操作重新读取", async () => {
  vi.mocked(imagePresetsIpc.list).mockResolvedValue([
    {
      ...emptyPresets("A", "图"),
      titlePic: { format: "jpeg" },
      titlePic2: { format: "webp" },
    },
    { ...emptyPresets("B", "图"), titlePic: { maxBytes: 1024 } },
  ]);
  expect(await imagePresetsService.resolve("A", "图", "titlePic2")).toEqual({
    format: "webp",
  });
  expect(await imagePresetsService.resolve("B", "图", "titlePic")).toEqual({
    maxBytes: 1024,
  });
  expect(await imagePresetsService.resolve("A", "未配置", "titlePic")).toEqual(
    {},
  );
  expect(imagePresetsIpc.list).toHaveBeenCalledTimes(3);
  vi.mocked(imagePresetsIpc.list).mockRejectedValueOnce(new Error("读取失败"));
  await expect(
    imagePresetsService.resolve("A", "图", "titlePic"),
  ).rejects.toThrow("读取失败");
});
it("保存前验证参数，无效请求不进入 IPC", () => {
  expect(() =>
    imagePresetsService.save({
      ...emptyPresets("A", "图"),
      titlePic: { size: { width: 5000, height: 5000 } },
    }),
  ).toThrow();
  expect(imagePresetsIpc.save).not.toHaveBeenCalled();
});
it("上传前复核结果尺寸、体积和 MIME，拒绝不符合预设的结果", async () => {
  const result: ImageProcessorResult = {
    file: new File(["encoded"], "encoded.jpg", { type: "image/jpeg" }),
    byteSize: 7,
    width: 280,
    height: 124,
    format: "jpeg",
  };
  for (const preset of [
    { format: "png" as const },
    { maxBytes: 6 },
    { size: { width: 281, height: 124 } },
  ]) {
    expect(() => imagePresetsService.upload(result, preset)).toThrow(
      "不符合子渠道图片预设",
    );
  }
  expect(() =>
    imagePresetsService.upload({ ...result, byteSize: 6 }, {}),
  ).toThrow();
  expect(() =>
    imagePresetsService.upload(
      {
        ...result,
        file: new File(["encoded"], "wrong.png", { type: "image/png" }),
      },
      {},
    ),
  ).toThrow();
  expect(channelService.upload).not.toHaveBeenCalled();
  vi.mocked(channelService.upload).mockResolvedValue({
    url: "https://img.example/encoded.jpg",
  });
  await expect(
    imagePresetsService.upload(result, {
      maxBytes: 7,
      size: { width: 280, height: 124 },
      format: "jpeg",
    }),
  ).resolves.toEqual({ url: "https://img.example/encoded.jpg" });
  expect(channelService.upload).toHaveBeenCalledExactlyOnceWith(result.file);
});
