import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ImageProcessor } from "@/features/images/ImageProcessor";
import { imageService } from "@/features/images/service";
import { chooseOption } from "./select-helpers";
import { invalidateClientRequests } from "@/services/tauri/client";
import type {
  ImageProcessorPreset,
  ImageProcessorResult,
} from "@/features/images/model";

vi.mock("@/features/images/service", async (original) => ({
  ...(await original<typeof import("@/features/images/service")>()),
  imageService: { inspect: vi.fn(), process: vi.fn(), export: vi.fn() },
}));
const file = new File(["original"], "original.png", { type: "image/png" });
const result: ImageProcessorResult = {
  file: new File(["encoded"], "original-processed.jpg", { type: "image/jpeg" }),
  width: 750,
  height: 750,
  format: "jpeg",
  byteSize: 7,
};
beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => `blob:test-${Math.random()}`);
  URL.revokeObjectURL = vi.fn();
  vi.mocked(imageService.inspect).mockResolvedValue({
    width: 1200,
    height: 800,
    format: "png",
    byteSize: 8,
    previewBase64: "AQID",
  });
  vi.mocked(imageService.process).mockResolvedValue({
    result,
    quality: 90,
    lossy: true,
  });
});
async function editor(preset: ImageProcessorPreset = {}) {
  const onConfirm = vi.fn(),
    onCancel = vi.fn();
  const view = render(
    <ImageProcessor
      image={file}
      preset={preset}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  await screen.findByRole("region", { name: "图片处理组件" });
  return { ...view, onConfirm, onCancel };
}

it("逐项锁定预设，重置保留锁定且裁剪框仍可调整", async () => {
  await editor({
    format: "jpeg",
    size: { width: 750, height: 750 },
    maxBytes: 100 * 1024,
  });
  expect(screen.getByLabelText(/图片格式/)).toBeDisabled();
  expect(screen.getByLabelText(/文件体积上限/)).toBeDisabled();
  expect(screen.getByLabelText("宽度 / px")).toBeDisabled();
  expect(screen.getByLabelText("指定输出宽高")).toBeChecked();
  expect(screen.getByRole("slider", { name: "优先画质" })).toBeEnabled();
  expect(document.querySelector(".ReactCrop--disabled")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重置" }));
  expect(screen.getByLabelText("宽度 / px")).toHaveValue(750);
  expect(screen.getByLabelText(/文件体积上限/)).toHaveValue(100);
  fireEvent.click(screen.getByRole("button", { name: "处理预览" }));
  await screen.findByAltText("实际编码后的图片");
  expect(imageService.process).toHaveBeenCalledWith(
    file,
    expect.objectContaining({
      format: "jpeg",
      size: { width: 750, height: 750 },
      maxBytes: 102400,
      crop: {
        x: expect.closeTo(1 / 6),
        y: 0,
        width: expect.closeTo(2 / 3),
        height: 1,
      },
    }),
    expect.anything(),
    expect.any(AbortSignal),
  );
});

it("未指定尺寸时默认不裁剪，缩放查看不改变提交参数", async () => {
  await editor();
  expect(screen.getByLabelText("指定输出宽高")).not.toBeChecked();
  expect(screen.getByLabelText("启用裁剪")).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "放大查看" }));
  fireEvent.click(screen.getByRole("button", { name: "处理预览" }));
  await waitFor(() => expect(imageService.process).toHaveBeenCalled());
  expect(imageService.process).toHaveBeenCalledWith(
    file,
    expect.objectContaining({
      size: undefined,
      crop: { x: 0, y: 0, width: 1, height: 1 },
    }),
    {},
    expect.any(AbortSignal),
  );
});

it("单个预设不锁定其他设置；参数变化使确认结果失效", async () => {
  const { onConfirm } = await editor({ format: "jpeg" });
  expect(screen.getByLabelText(/文件体积上限/)).toBeEnabled();
  expect(screen.getByLabelText("指定输出宽高")).toBeEnabled();
  expect(screen.getByRole("button", { name: "确认结果" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "处理预览" }));
  await screen.findByAltText("实际编码后的图片");
  fireEvent.click(screen.getByRole("button", { name: "确认结果" }));
  expect(onConfirm).toHaveBeenCalledWith(result);
  fireEvent.change(screen.getByLabelText(/文件体积上限/), {
    target: { value: "100" },
  });
  expect(screen.getByRole("button", { name: "确认结果" })).toBeDisabled();
});

it("格式下拉显示中文映射，变更格式使旧结果失效并提交实际格式", async () => {
  await editor();
  const format = screen.getByLabelText("图片格式");
  expect(format).toHaveTextContent("PNG");
  fireEvent.click(screen.getByRole("button", { name: "处理预览" }));
  await screen.findByAltText("实际编码后的图片");
  await chooseOption(format, "WebP");
  expect(format).toHaveTextContent("WebP");
  expect(screen.getByRole("button", { name: "确认结果" })).toBeDisabled();
  expect(screen.queryByAltText("实际编码后的图片")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "处理预览" }));
  await waitFor(() =>
    expect(imageService.process).toHaveBeenLastCalledWith(
      file,
      expect.objectContaining({ format: "webp" }),
      {},
      expect.any(AbortSignal),
    ),
  );
});

it("超限错误明确展示且禁止确认；取消处理不会回填旧结果", async () => {
  vi.mocked(imageService.process).mockRejectedValueOnce(
    new Error("当前最小结果 5000 B，上限 100 B"),
  );
  await editor();
  fireEvent.click(screen.getByRole("button", { name: "处理预览" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("上限 100 B");
  expect(screen.getByRole("button", { name: "确认结果" })).toBeDisabled();
  let release!: (
    value: Awaited<ReturnType<typeof imageService.process>>,
  ) => void;
  vi.mocked(imageService.process).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "处理预览" }));
  fireEvent.click(screen.getByRole("button", { name: "重置" }));
  await act(async () => release({ result, quality: 90, lossy: true }));
  expect(screen.queryByAltText("实际编码后的图片")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "确认结果" })).toBeDisabled();
});

it("切换图片和会话失效会丢弃结果并释放预览 URL", async () => {
  const { rerender, unmount } = await editor();
  fireEvent.click(screen.getByRole("button", { name: "处理预览" }));
  await screen.findByAltText("实际编码后的图片");
  const next = new File(["new"], "new.png", { type: "image/png" });
  rerender(
    <ImageProcessor image={next} onConfirm={vi.fn()} onCancel={vi.fn()} />,
  );
  await screen.findByRole("region", { name: "图片处理组件" });
  expect(screen.getByRole("button", { name: "确认结果" })).toBeDisabled();
  act(() => invalidateClientRequests());
  expect(await screen.findByRole("alert")).toHaveTextContent("登录状态已变化");
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});

it("无效预设不读取图片", async () => {
  render(
    <ImageProcessor
      image={file}
      preset={{ maxBytes: 0 }}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("图片预设无效");
  expect(imageService.inspect).not.toHaveBeenCalled();
});

it("读取阶段取消立即终止检查，即使父组件暂未卸载也不回填", async () => {
  let release!: (
    value: Awaited<ReturnType<typeof imageService.inspect>>,
  ) => void;
  vi.mocked(imageService.inspect).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const onCancel = vi.fn();
  render(
    <ImageProcessor image={file} onConfirm={vi.fn()} onCancel={onCancel} />,
  );
  await screen.findByRole("status");
  const signal = vi.mocked(imageService.inspect).mock.calls[0][1]!;
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(signal.aborted).toBe(true);
  expect(onCancel).toHaveBeenCalledOnce();
  await act(async () =>
    release({
      width: 1200,
      height: 800,
      format: "png",
      byteSize: 8,
      previewBase64: "AQID",
    }),
  );
  expect(
    screen.queryByRole("region", { name: "图片处理组件" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("已取消");
});
