import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import Images from "@/pages/Images";
import { imageService } from "@/features/images/service";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/images/service", () => ({
  imageService: { export: vi.fn() },
}));
vi.mock("@/features/images", () => ({
  ImageProcessor: ({ onConfirm }: { onConfirm: (result: unknown) => void }) => (
    <button
      onClick={() => onConfirm({ file: new File(["encoded"], "new.png") })}
    >
      确认测试结果
    </button>
  ),
}));
beforeEach(() => vi.clearAllMocks());

function choose() {
  fireEvent.change(screen.getByLabelText("选择本地图片"), {
    target: {
      files: [new File(["original"], "original.png", { type: "image/png" })],
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "确认测试结果" }));
}

it("系统对话框取消不显示成功；实际保存成功才通知完成", async () => {
  vi.mocked(imageService.export).mockResolvedValueOnce({
    saved: false,
    fileName: null,
  });
  render(<Images />);
  choose();
  await waitFor(() =>
    expect(screen.queryByRole("status")).not.toBeInTheDocument(),
  );
  expect(toast.success).not.toHaveBeenCalled();
  vi.mocked(imageService.export).mockResolvedValueOnce({
    saved: true,
    fileName: "new.png",
  });
  fireEvent.click(screen.getByRole("button", { name: "确认测试结果" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("图片已保存：new.png"),
  );
});

it("取消导出及页面卸载会终止导出会话", async () => {
  let signal!: AbortSignal;
  let release!: (value: { saved: boolean; fileName: string | null }) => void;
  vi.mocked(imageService.export).mockImplementationOnce((_result, current) => {
    signal = current!;
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const { unmount } = render(<Images />);
  choose();
  fireEvent.click(screen.getByRole("button", { name: "取消导出" }));
  expect(signal.aborted).toBe(true);
  await act(async () => release({ saved: true, fileName: "stale.png" }));
  expect(toast.success).not.toHaveBeenCalled();
  vi.mocked(imageService.export).mockImplementationOnce((_result, current) => {
    signal = current!;
    return new Promise(() => {});
  });
  fireEvent.click(screen.getByRole("button", { name: "确认测试结果" }));
  unmount();
  expect(signal.aborted).toBe(true);
});
