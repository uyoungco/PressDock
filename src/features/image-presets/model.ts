import { z } from "zod";
import {
  imagePresetSchema,
  type ImageProcessorPreset,
} from "@/features/images/model";

export const imageFields = ["titlePic", "titlePic2"] as const;
export type MaterialImageField = (typeof imageFields)[number];
export const imageFieldLabels = {
  titlePic: "TitlePic",
  titlePic2: "TitlePic2",
} as const;
export const channelImagePresetsSchema = z.object({
  channel: z.string().refine((value) => !!value.trim(), "请选择渠道"),
  subChannel: z.string().refine((value) => !!value.trim(), "请选择子渠道"),
  titlePic: imagePresetSchema,
  titlePic2: imagePresetSchema,
});
export type ChannelImagePresets = z.infer<typeof channelImagePresetsSchema>;
export const emptyPresets = (
  channel: string,
  subChannel: string,
): ChannelImagePresets => ({
  channel,
  subChannel,
  titlePic: {},
  titlePic2: {},
});
export const hasPreset = (preset: ImageProcessorPreset) =>
  preset.size !== undefined ||
  preset.maxBytes !== undefined ||
  preset.format !== undefined;
