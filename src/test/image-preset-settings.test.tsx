import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ImagePresetSettings } from "@/features/image-presets/ImagePresetSettings";
import { imagePresetsService } from "@/features/image-presets/service";
import { channelService } from "@/features/channels/service";
import { emptyPresets } from "@/features/image-presets/model";
import { chooseOption } from "./select-helpers";
import { deferred } from "./cms-fixtures";

vi.mock("@/features/image-presets/service", () => ({
  imagePresetsService: { list: vi.fn(), save: vi.fn() },
}));
vi.mock("@/features/channels/service", () => ({
  channelService: { groups: vi.fn() },
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(channelService.groups).mockResolvedValue([
    { channel: "A", subchannels: ["轮播图"] },
    { channel: "B", subchannels: ["轮播图"] },
  ]);
  vi.mocked(imagePresetsService.list).mockResolvedValue([]);
  vi.mocked(imagePresetsService.save).mockImplementation(
    async (request) => request,
  );
});
async function select(channel = "A", subChannel = "轮播图") {
  await chooseOption(await screen.findByLabelText("预设渠道"), channel);
  await chooseOption(screen.getByLabelText("预设子渠道"), subChannel);
}
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

it("两个字段独立配置，KiB 转为字节并保留部分预设", async () => {
  render(<ImagePresetSettings />);
  await select();
  change("TitlePic 宽（px）", "280");
  change("TitlePic 高（px）", "124");
  change("TitlePic 体积上限（KiB）", "100.5");
  await chooseOption(screen.getByLabelText("TitlePic 输出格式"), "JPG / JPEG");
  await chooseOption(screen.getByLabelText("TitlePic2 输出格式"), "WebP");
  await userEvent.click(screen.getByRole("button", { name: "保存图片预设" }));
  await waitFor(() =>
    expect(imagePresetsService.save).toHaveBeenCalledWith({
      channel: "A",
      subChannel: "轮播图",
      titlePic: {
        size: { width: 280, height: 124 },
        maxBytes: 102912,
        format: "jpeg",
      },
      titlePic2: { size: undefined, maxBytes: undefined, format: "webp" },
    }),
  );
});

it("宽高成对校验、资源边界和失败后重试", async () => {
  render(<ImagePresetSettings />);
  await select();
  change("TitlePic 宽（px）", "280");
  await userEvent.click(screen.getByRole("button", { name: "保存图片预设" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "宽、高必须成对填写",
  );
  expect(imagePresetsService.save).not.toHaveBeenCalled();
  change("TitlePic 高（px）", "124");
  change("TitlePic2 体积上限（KiB）", "20481");
  await userEvent.click(screen.getByRole("button", { name: "保存图片预设" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("20480 KiB");
  expect(imagePresetsService.save).not.toHaveBeenCalled();
  change("TitlePic2 体积上限（KiB）", "");
  vi.mocked(imagePresetsService.save).mockRejectedValueOnce(
    new Error("磁盘写入失败"),
  );
  await userEvent.click(screen.getByRole("button", { name: "保存图片预设" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("磁盘写入失败");
  expect(screen.getByLabelText("TitlePic 宽（px）")).toHaveValue(280);
  await userEvent.click(screen.getByRole("button", { name: "保存图片预设" }));
  await waitFor(() =>
    expect(imagePresetsService.save).toHaveBeenCalledTimes(2),
  );
});

it("同名子渠道跨渠道隔离，历史预设仍可编辑且单独清空", async () => {
  vi.mocked(imagePresetsService.list).mockResolvedValue([
    { ...emptyPresets("A", "轮播图"), titlePic: { maxBytes: 1024 } },
    {
      ...emptyPresets("历史渠道", "历史子渠道"),
      titlePic: { format: "png" },
      titlePic2: { format: "webp" },
    },
  ]);
  render(<ImagePresetSettings />);
  await select();
  expect(screen.getByLabelText("TitlePic 体积上限（KiB）")).toHaveValue(1);
  await select("B");
  expect(screen.getByLabelText("TitlePic 体积上限（KiB）")).toHaveValue(null);
  await select("历史渠道", "历史子渠道");
  expect(screen.getByLabelText("TitlePic 输出格式")).toHaveTextContent("PNG");
  await userEvent.click(
    screen.getByRole("button", { name: "清空 TitlePic 预设" }),
  );
  expect(screen.getByLabelText("TitlePic2 输出格式")).toHaveTextContent("WebP");
  await userEvent.click(screen.getByRole("button", { name: "保存图片预设" }));
  await waitFor(() =>
    expect(imagePresetsService.save).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "历史渠道",
        subChannel: "历史子渠道",
        titlePic: {},
        titlePic2: expect.objectContaining({ format: "webp" }),
      }),
    ),
  );
});

it("读取失败禁止编辑，重试恢复；保存中阻止重复提交和切换渠道", async () => {
  vi.mocked(imagePresetsService.list).mockRejectedValueOnce(
    new Error("读取失败"),
  );
  render(<ImagePresetSettings />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "图片预设读取失败",
  );
  expect(screen.getByLabelText("预设渠道")).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "重新读取预设与渠道" }),
  );
  await select();
  const pending = deferred<ReturnType<typeof emptyPresets>>();
  vi.mocked(imagePresetsService.save).mockReturnValueOnce(pending.promise);
  await userEvent.click(screen.getByRole("button", { name: "保存图片预设" }));
  expect(screen.getByRole("button", { name: "正在保存预设…" })).toBeDisabled();
  expect(screen.getByLabelText("预设渠道")).toBeDisabled();
  expect(imagePresetsService.save).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(emptyPresets("A", "轮播图")));
});
