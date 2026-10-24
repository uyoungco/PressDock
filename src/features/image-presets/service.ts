import { imagePresetsIpc } from "@/services/tauri/image-presets";
import {
  channelImagePresetsSchema,
  type ChannelImagePresets,
  type MaterialImageField,
} from "./model";
import {
  IMAGE_MIMES,
  imagePresetSchema,
  imageSizeSchema,
  type ImageProcessorPreset,
  type ImageProcessorResult,
} from "@/features/images/model";
import { channelService } from "@/features/channels/service";

export const imagePresetsService = {
  list: () => imagePresetsIpc.list(),
  save: (request: ChannelImagePresets) =>
    imagePresetsIpc.save(channelImagePresetsSchema.parse(request)),
  resolve: async (
    channel: string,
    subChannel: string,
    field: MaterialImageField,
  ): Promise<ImageProcessorPreset> => {
    const configs = await imagePresetsIpc.list();
    return (
      configs.find(
        (config) =>
          config.channel === channel && config.subChannel === subChannel,
      )?.[field] ?? {}
    );
  },
  upload: (result: ImageProcessorResult, preset: ImageProcessorPreset) => {
    const locked = imagePresetSchema.parse(preset);
    imageSizeSchema.parse({ width: result.width, height: result.height });
    if (
      !result.byteSize ||
      result.file.size !== result.byteSize ||
      result.file.type !== IMAGE_MIMES[result.format] ||
      (locked.format && result.format !== locked.format) ||
      (locked.maxBytes !== undefined && result.byteSize > locked.maxBytes) ||
      (locked.size &&
        (result.width !== locked.size.width ||
          result.height !== locked.size.height))
    ) {
      throw new Error("处理结果不符合子渠道图片预设，请重新处理");
    }
    return channelService.upload(result.file);
  },
};
