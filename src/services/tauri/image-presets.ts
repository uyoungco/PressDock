import {
  channelImagePresetsSchema,
  type ChannelImagePresets,
} from "@/features/image-presets/model";
import { invokeCommand } from "./client";

export const imagePresetsIpc = {
  list: () =>
    invokeCommand(
      "list_channel_image_presets",
      channelImagePresetsSchema.array(),
    ),
  save: (request: ChannelImagePresets) =>
    invokeCommand("save_channel_image_presets", channelImagePresetsSchema, {
      request: channelImagePresetsSchema.parse(request),
    }),
};
