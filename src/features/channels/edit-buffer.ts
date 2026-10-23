import type { PromoteInput, PromoteRecord } from "@/types/cms";
export type MaterialEdit = { base: PromoteRecord | null; input: PromoteInput };
export const blankInput = (): PromoteInput => ({
  channel: "",
  subChannel: "",
  publishDate: "",
  url: "",
  title: "",
  titlePic: "",
  titlePic2: "",
  smallText: "",
  writer: "",
});
export function recordInput(record: PromoteRecord): PromoteInput {
  return {
    channel: record.channel ?? "",
    subChannel: record.subChannel,
    publishDate: record.publishDate?.slice(0, 10) ?? null,
    url: record.url,
    title: record.title ?? "",
    titlePic: record.titlePic ?? "",
    titlePic2: record.titlePic2,
    smallText: record.smallText,
    writer: record.writer,
  };
}
export const editIsDirty = (edit: MaterialEdit | null) =>
  !!edit &&
  JSON.stringify(edit.input) !==
    JSON.stringify(edit.base ? recordInput(edit.base) : blankInput());
const buffers = new Map<number, MaterialEdit>();
export const channelEditBuffers = {
  get: (user: number) => buffers.get(user) ?? null,
  set: (user: number, edit: MaterialEdit) =>
    buffers.set(user, structuredClone(edit)),
  remove: (user: number) => buffers.delete(user),
  clear: () => buffers.clear(),
  retainUser: (user: number) => {
    for (const key of buffers.keys()) if (key !== user) buffers.delete(key);
  },
};
