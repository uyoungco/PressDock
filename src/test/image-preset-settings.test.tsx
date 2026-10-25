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
import {
  emptyPresets,
  type ChannelImagePresets,
} from "@/features/image-presets/model";
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
  expect(screen.getByLabelText("复制来源")).toBeDisabled();
  expect(screen.getByRole("button", { name: "复制预设" })).toBeDisabled();
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

it("跨渠道搜索并复制两套完整预设，手动保存失败后可重试", async () => {
  const source: ChannelImagePresets = {
    channel: "A",
    subChannel: "轮播图",
    titlePic: {
      size: { width: 280, height: 124 },
      maxBytes: 102912,
      format: "jpeg",
    },
    titlePic2: {
      size: { width: 506, height: 180 },
      maxBytes: 61440,
      format: "png",
    },
  };
  vi.mocked(imagePresetsService.list).mockResolvedValue([source]);
  render(<ImagePresetSettings />);
  await select("B");
  const copyButton = screen.getByRole("button", { name: "复制预设" });
  expect(copyButton).toBeDisabled();
  await userEvent.click(screen.getByLabelText("复制来源"));
  await userEvent.type(
    await screen.findByPlaceholderText("搜索来源渠道或子渠道…"),
    "a / 轮播",
  );
  expect(screen.getByRole("option", { name: "A / 轮播图" })).toBeVisible();
  await userEvent.keyboard("{ArrowDown}{Enter}");
  await waitFor(() =>
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText("TitlePic 宽（px）")).toHaveValue(null);
  await userEvent.click(copyButton);
  expect(imagePresetsService.save).not.toHaveBeenCalled();
  for (const [label, value] of [
    ["TitlePic 宽（px）", 280],
    ["TitlePic 高（px）", 124],
    ["TitlePic 体积上限（KiB）", 100.5],
    ["TitlePic2 宽（px）", 506],
    ["TitlePic2 高（px）", 180],
    ["TitlePic2 体积上限（KiB）", 60],
  ] as const) {
    expect(screen.getByLabelText(label)).toHaveValue(value);
  }
  expect(screen.getByLabelText("TitlePic 输出格式")).toHaveTextContent(
    "JPG / JPEG",
  );
  expect(screen.getByLabelText("TitlePic2 输出格式")).toHaveTextContent("PNG");
  vi.mocked(imagePresetsService.save).mockRejectedValueOnce(
    new Error("磁盘写入失败"),
  );
  await userEvent.click(screen.getByRole("button", { name: "保存图片预设" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("磁盘写入失败");
  expect(screen.getByLabelText("TitlePic 宽（px）")).toHaveValue(280);
  expect(screen.getByLabelText("TitlePic2 体积上限（KiB）")).toHaveValue(60);
  await userEvent.click(screen.getByRole("button", { name: "保存图片预设" }));
  await waitFor(() =>
    expect(imagePresetsService.save).toHaveBeenCalledTimes(2),
  );
  expect(imagePresetsService.save).toHaveBeenLastCalledWith({
    ...source,
    channel: "B",
  });
});

it("只复制已保存值，部分预设和空值完整替换目标且草稿互相独立", async () => {
  const source: ChannelImagePresets = {
    ...emptyPresets("A", "轮播图"),
    titlePic: { maxBytes: 1024, format: "png" },
  };
  vi.mocked(imagePresetsService.list).mockResolvedValue([
    source,
    {
      ...emptyPresets("B", "轮播图"),
      titlePic: { size: { width: 100, height: 100 }, format: "jpeg" },
      titlePic2: {
        size: { width: 200, height: 200 },
        maxBytes: 2048,
        format: "webp",
      },
    },
  ]);
  render(<ImagePresetSettings />);
  await select("A");
  change("TitlePic 体积上限（KiB）", "99");
  await select("B");
  change("TitlePic 宽（px）", "300");
  await chooseOption(screen.getByLabelText("复制来源"), "A / 轮播图");
  await userEvent.click(screen.getByRole("button", { name: "复制预设" }));
  expect(screen.getByLabelText("TitlePic 体积上限（KiB）")).toHaveValue(1);
  expect(screen.getByLabelText("TitlePic 输出格式")).toHaveTextContent("PNG");
  for (const label of [
    "TitlePic 宽（px）",
    "TitlePic 高（px）",
    "TitlePic2 宽（px）",
    "TitlePic2 高（px）",
    "TitlePic2 体积上限（KiB）",
  ]) {
    expect(screen.getByLabelText(label)).toHaveValue(null);
  }
  expect(screen.getByLabelText("TitlePic2 输出格式")).toHaveTextContent(
    "不限制（默认源格式）",
  );
  change("TitlePic 体积上限（KiB）", "2");
  await select("A");
  expect(screen.getByLabelText("TitlePic 体积上限（KiB）")).toHaveValue(99);
  await select("B");
  expect(screen.getByLabelText("TitlePic 体积上限（KiB）")).toHaveValue(2);
  expect(source.titlePic).toEqual({ maxBytes: 1024, format: "png" });
  expect(source.titlePic2).toEqual({});
  expect(imagePresetsService.save).not.toHaveBeenCalled();
});

it("来源排除当前子渠道、空配置及未保存草稿，切换目标清空来源", async () => {
  vi.mocked(channelService.groups).mockResolvedValue([
    { channel: "A", subchannels: ["轮播图", "空配置", "未保存"] },
    { channel: "B", subchannels: ["轮播图"] },
  ]);
  vi.mocked(imagePresetsService.list).mockResolvedValue([
    { ...emptyPresets("A", "轮播图"), titlePic: { format: "png" } },
    { ...emptyPresets("B", "轮播图"), titlePic2: { format: "webp" } },
    emptyPresets("A", "空配置"),
  ]);
  render(<ImagePresetSettings />);
  await select("A", "未保存");
  change("TitlePic 体积上限（KiB）", "10");
  await chooseOption(screen.getByLabelText("预设子渠道"), "轮播图");
  await userEvent.click(screen.getByLabelText("复制来源"));
  expect(await screen.findAllByRole("option")).toHaveLength(1);
  expect(screen.getByRole("option", { name: "B / 轮播图" })).toBeVisible();
  await userEvent.click(screen.getByRole("option", { name: "B / 轮播图" }));
  expect(screen.getByRole("button", { name: "复制预设" })).toBeEnabled();
  await chooseOption(screen.getByLabelText("预设子渠道"), "空配置");
  expect(screen.getByLabelText("复制来源")).toHaveTextContent(
    "请选择已保存的预设",
  );
  expect(screen.getByRole("button", { name: "复制预设" })).toBeDisabled();
  await chooseOption(screen.getByLabelText("复制来源"), "B / 轮播图");
  await chooseOption(screen.getByLabelText("预设渠道"), "B");
  expect(screen.getByLabelText("复制来源")).toBeDisabled();
  expect(screen.getByLabelText("复制来源")).toHaveTextContent(
    "请先选择目标子渠道",
  );
  expect(screen.getByRole("button", { name: "复制预设" })).toBeDisabled();
  await chooseOption(screen.getByLabelText("预设子渠道"), "轮播图");
  await userEvent.click(screen.getByLabelText("复制来源"));
  expect(await screen.findAllByRole("option")).toHaveLength(1);
  expect(screen.getByRole("option", { name: "A / 轮播图" })).toBeVisible();
});

it("无可用来源时禁止复制，未保存的新配置不能作为来源", async () => {
  render(<ImagePresetSettings />);
  expect(screen.getByLabelText("复制来源")).toBeDisabled();
  expect(screen.getByRole("button", { name: "复制预设" })).toBeDisabled();
  await select("A");
  change("TitlePic 体积上限（KiB）", "10");
  await select("B");
  expect(screen.getByLabelText("复制来源")).toBeDisabled();
  expect(screen.getByLabelText("复制来源")).toHaveTextContent(
    "暂无其他已保存预设",
  );
  expect(screen.getByRole("button", { name: "复制预设" })).toBeDisabled();
});

it("加载和保存期间锁定复制，保存后配置可作为其他子渠道的来源", async () => {
  const loading = deferred<ChannelImagePresets[]>();
  vi.mocked(imagePresetsService.list).mockReturnValueOnce(loading.promise);
  render(<ImagePresetSettings />);
  expect(screen.getByRole("status")).toHaveTextContent("正在读取图片预设");
  expect(screen.getByLabelText("复制来源")).toBeDisabled();
  expect(screen.getByRole("button", { name: "复制预设" })).toBeDisabled();
  await act(async () =>
    loading.resolve([
      { ...emptyPresets("A", "轮播图"), titlePic: { format: "png" } },
    ]),
  );
  await select("B");
  await chooseOption(screen.getByLabelText("复制来源"), "A / 轮播图");
  await userEvent.click(screen.getByRole("button", { name: "复制预设" }));
  const saving = deferred<ChannelImagePresets>();
  vi.mocked(imagePresetsService.save).mockReturnValueOnce(saving.promise);
  await userEvent.click(screen.getByRole("button", { name: "保存图片预设" }));
  expect(screen.getByLabelText("复制来源")).toBeDisabled();
  expect(screen.getByRole("button", { name: "复制预设" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "复制预设" }));
  expect(imagePresetsService.save).toHaveBeenCalledTimes(1);
  await act(async () =>
    saving.resolve({
      ...emptyPresets("B", "轮播图"),
      titlePic: { format: "png" },
    }),
  );
  await select("A");
  await chooseOption(screen.getByLabelText("复制来源"), "B / 轮播图");
  await userEvent.click(screen.getByRole("button", { name: "复制预设" }));
  expect(screen.getByLabelText("TitlePic 输出格式")).toHaveTextContent("PNG");
  expect(imagePresetsService.save).toHaveBeenCalledTimes(1);
});
