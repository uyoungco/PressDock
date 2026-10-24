import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { MaterialForm } from "@/features/channels/MaterialForm";
import { blankInput, recordInput } from "@/features/channels/edit-buffer";
import { channelService } from "@/features/channels/service";
import { imagePresetsService } from "@/features/image-presets/service";
import { imageService } from "@/features/images/service";
import { invalidateClientRequests } from "@/services/tauri/client";
import type {
  ImageProcessorPreset,
  ImageProcessorResult,
} from "@/features/images/model";
import { deferred, material } from "./cms-fixtures";

vi.mock("@/features/image-presets/service", async (original) => {
  const actual =
    await original<typeof import("@/features/image-presets/service")>();
  return {
    imagePresetsService: { ...actual.imagePresetsService, resolve: vi.fn() },
  };
});
vi.mock("@/features/images/service", async (original) => ({
  ...(await original<typeof import("@/features/images/service")>()),
  imageService: { inspect: vi.fn(), process: vi.fn() },
}));
const file = new File(["source"], "source.png", { type: "image/png" });
const output: ImageProcessorResult = {
  file: new File(["processed"], "processed.jpg", { type: "image/jpeg" }),
  format: "jpeg",
  width: 280,
  height: 124,
  byteSize: 9,
};
const saved = vi.fn(),
  changed = vi.fn(),
  working = vi.fn();
function Harness({ editing = true }: { editing?: boolean }) {
  const [input, setInput] = useState({
    ...blankInput(),
    ...recordInput({
      ...material(),
      titlePic: "https://img.example/old.png",
      titlePic2: "https://img.example/old2.png",
    }),
  });
  const [open, setOpen] = useState(true);
  return open ? (
    <MaterialForm
      edit={{ base: editing ? material() : null, input }}
      onChange={(next) => {
        changed(next);
        setInput(next);
      }}
      onClose={() => setOpen(false)}
      onSave={saved}
      busy={false}
      onUploading={working}
      error={null}
    />
  ) : (
    <p>表单已关闭</p>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => "blob:image-test");
  URL.revokeObjectURL = vi.fn();
  vi.mocked(imagePresetsService.resolve).mockResolvedValue({});
  vi.mocked(imageService.inspect).mockResolvedValue({
    width: 1200,
    height: 800,
    format: "png",
    byteSize: file.size,
    previewBase64: "AQID",
  });
  vi.mocked(imageService.process).mockResolvedValue({
    result: output,
    quality: 90,
    lossy: true,
  });
  vi.spyOn(channelService, "upload").mockResolvedValue({
    url: "https://img.example/processed.jpg",
  });
});
const pic = () => screen.getByLabelText("* TitlePic", { exact: true });
async function selectImage(field = "TitlePic") {
  await userEvent.upload(
    screen.getByLabelText(`上传 ${field}`, { exact: true }),
    file,
  );
  return screen.findByRole("dialog", { name: `处理 ${field}` });
}
async function processAndConfirm() {
  await userEvent.click(
    await screen.findByRole("button", { name: "处理预览" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "确认结果" }),
  );
}
function pasteImages(target: HTMLElement, files: File[]) {
  return fireEvent.paste(target, {
    clipboardData: {
      items: files.map((item) => ({
        kind: "file",
        type: item.type,
        getAsFile: () => item,
      })),
    },
  });
}

it.each([true, false])(
  "新增和修改均传入锁定预设，仅上传处理结果，回填正确字段（修改=%s）",
  async (editing) => {
    const preset = {
      size: { width: 280, height: 124 },
      maxBytes: 102400,
      format: "jpeg",
    } satisfies ImageProcessorPreset;
    vi.mocked(imagePresetsService.resolve).mockResolvedValue(preset);
    render(<Harness editing={editing} />);
    const form = screen.getByRole("dialog", {
      name: editing ? "修改素材" : "新增素材",
    });
    await selectImage("TitlePic2");
    await screen.findByRole("region", { name: "图片处理组件" });
    expect(imagePresetsService.resolve).toHaveBeenCalledWith(
      "KOOK",
      "轮播图",
      "titlePic2",
    );
    expect(screen.getByLabelText("宽度 / px")).toBeDisabled();
    expect(screen.getByLabelText(/图片格式/)).toBeDisabled();
    expect(screen.getByLabelText(/文件体积上限/)).toBeDisabled();
    expect(
      within(form).getByRole("button", { name: "保存素材", hidden: true }),
    ).toBeDisabled();
    expect(within(form).getByLabelText("* Channel")).toBeDisabled();
    expect(channelService.upload).not.toHaveBeenCalled();
    await processAndConfirm();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "处理 TitlePic2" }),
      ).not.toBeInTheDocument(),
    );
    expect(channelService.upload).toHaveBeenCalledExactlyOnceWith(output.file);
    expect(pic()).toHaveValue("https://img.example/old.png");
    expect(screen.getByRole("textbox", { name: "TitlePic2" })).toHaveValue(
      "https://img.example/processed.jpg",
    );
    expect(saved).not.toHaveBeenCalled();
  },
);

it("无预设允许调整；取消与 Escape 仅关闭图片弹框并恢复输入框焦点", async () => {
  render(<Harness />);
  await selectImage();
  await screen.findByRole("region", { name: "图片处理组件" });
  expect(screen.getByLabelText(/图片格式/)).toBeEnabled();
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(pic()).toHaveFocus());
  expect(pic()).toHaveValue("https://img.example/old.png");
  expect(screen.getByRole("dialog", { name: "修改素材" })).toBeInTheDocument();
  await selectImage();
  await screen.findByRole("region", { name: "图片处理组件" });
  await userEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => expect(pic()).toHaveFocus());
  expect(channelService.upload).not.toHaveBeenCalled();
});

it.each(["TitlePic", "TitlePic2"])(
  "粘贴仅在 %s 获得焦点时触发，并取第一张图",
  async (field) => {
    render(<Harness />);
    const input =
      field === "TitlePic"
        ? pic()
        : screen.getByRole("textbox", { name: "TitlePic2" });
    screen.getByLabelText("* Title", { exact: true }).focus();
    expect(pasteImages(input, [file])).toBe(true);
    expect(imagePresetsService.resolve).not.toHaveBeenCalled();
    pasteImages(document.body, [file]);
    expect(imagePresetsService.resolve).not.toHaveBeenCalled();
    input.focus();
    expect(
      pasteImages(input, [
        file,
        new File(["second"], "second.png", { type: "image/png" }),
      ]),
    ).toBe(false);
    await screen.findByRole("region", { name: "图片处理组件" });
    expect(imageService.inspect).toHaveBeenCalledWith(
      file,
      expect.any(AbortSignal),
    );
    expect(imagePresetsService.resolve).toHaveBeenCalledExactlyOnceWith(
      "KOOK",
      "轮播图",
      field === "TitlePic" ? "titlePic" : "titlePic2",
    );
  },
);

it("纯文本照常粘贴，不支持的图片明确报错且不上传", async () => {
  render(<Harness />);
  await userEvent.clear(pic());
  await userEvent.paste("https://img.example/text.png");
  expect(pic()).toHaveValue("https://img.example/text.png");
  expect(imagePresetsService.resolve).not.toHaveBeenCalled();
  expect(
    pasteImages(pic(), [
      new File(["gif"], "animation.gif", { type: "image/gif" }),
    ]),
  ).toBe(false);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "静态 JPG、PNG 或 WebP",
  );
  expect(channelService.upload).not.toHaveBeenCalled();
});

it("读取预设失败不能绕过，可重试；上传失败保留结果，可手动重试", async () => {
  vi.mocked(imagePresetsService.resolve).mockRejectedValueOnce(
    new Error("数据库忙"),
  );
  vi.mocked(channelService.upload).mockRejectedValueOnce(new Error("上传失败"));
  render(<Harness />);
  await selectImage();
  expect(await screen.findByRole("alert")).toHaveTextContent("数据库忙");
  expect(
    screen.queryByRole("region", { name: "图片处理组件" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "重试读取预设" }));
  await processAndConfirm();
  expect(await screen.findByRole("alert")).toHaveTextContent("上传失败");
  expect(imageService.process).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "确认结果" }));
  await waitFor(() =>
    expect(pic()).toHaveValue("https://img.example/processed.jpg"),
  );
  expect(imageService.process).toHaveBeenCalledTimes(1);
  expect(channelService.upload).toHaveBeenCalledTimes(2);
});

it.each(["取消", "卸载", "会话失效"])(
  "上传期间%s后丢弃旧回调，重复确认不重复上传",
  async (action) => {
    const pending = deferred<{ url: string }>();
    vi.mocked(channelService.upload).mockReturnValueOnce(pending.promise);
    const view = render(<Harness />);
    await selectImage();
    await processAndConfirm();
    fireEvent.click(
      screen.getByRole("button", { name: "确认结果", hidden: true }),
    );
    expect(channelService.upload).toHaveBeenCalledTimes(1);
    if (action === "取消")
      await userEvent.click(screen.getByRole("button", { name: "取消回填" }));
    else if (action === "卸载") view.unmount();
    else act(() => invalidateClientRequests());
    await act(async () =>
      pending.resolve({ url: "https://img.example/late.jpg" }),
    );
    expect(changed).not.toHaveBeenCalled();
    if (action !== "卸载") {
      expect(pic()).toHaveValue("https://img.example/old.png");
      expect(screen.getByRole("button", { name: "保存素材" })).toBeEnabled();
    }
  },
);

it("取消预设读取后，旧预设不打开新弹框", async () => {
  const pending = deferred<ImageProcessorPreset>();
  vi.mocked(imagePresetsService.resolve).mockReturnValueOnce(pending.promise);
  render(<Harness />);
  await selectImage();
  await userEvent.click(screen.getByRole("button", { name: "取消图片处理" }));
  await act(async () => pending.resolve({ format: "png" }));
  expect(
    screen.queryByRole("region", { name: "图片处理组件" }),
  ).not.toBeInTheDocument();
  expect(imageService.inspect).not.toHaveBeenCalled();
});
