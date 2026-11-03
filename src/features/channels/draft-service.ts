import { z } from "zod";
import { invokeCommand, onClientInvalidated } from "@/services/tauri/client";
import { promoteRecordSchema } from "@/types/cms";
import type { MaterialEdit } from "./edit-buffer";

const text = z.string().nullable();
const draftSchema = z.object({
  base: promoteRecordSchema.nullable(),
  input: z.object({
    channel: z.string(),
    subChannel: text,
    publishDate: text,
    url: text,
    title: z.string(),
    titlePic: z.string(),
    titlePic2: text,
    smallText: text,
    writer: text,
  }),
});
let epoch = 0;
let queue: Promise<void> = Promise.resolve();
onClientInvalidated(() => {
  epoch += 1;
});
function write(user: number, draft: MaterialEdit | null) {
  const version = epoch;
  const snapshot = draft ? structuredClone(draft) : null;
  const operation = queue
    .catch(() => undefined)
    .then(async () => {
      if (version !== epoch) throw new Error("登录状态已变化，草稿未保存");
      await invokeCommand(
        snapshot ? "channel_draft_save" : "channel_draft_clear",
        z.null(),
        { expectedUser: user, ...(snapshot ? { draft: snapshot } : {}) },
      );
    });
  queue = operation;
  return operation;
}
export const channelDraftService = {
  load: () => invokeCommand("channel_draft_load", draftSchema.nullable()),
  save: (user: number, draft: MaterialEdit) => write(user, draft),
  clear: (user: number) => write(user, null),
};
