import { z } from "zod";

export const loginInputSchema = z.object({
  username: z.string().trim().min(1, "请输入用户名"),
  password: z.string().min(1, "请输入密码"),
});
export type LoginInput = z.infer<typeof loginInputSchema>;
export const authSessionSchema = z.object({
  user: z.object({
    userId: z.number().int().positive(),
    nickname: z.string().min(1),
    roles: z.array(z.string()).min(1),
    perms: z.array(z.string()),
  }),
  persistent: z.boolean(),
});
export type AuthSession = z.infer<typeof authSessionSchema>;
export const logoutResultSchema = z.object({
  remoteSucceeded: z.boolean(),
  credentialsCleared: z.boolean(),
});
export const channelGroupsSchema = z.array(
  z.object({
    channel: z.string().min(1),
    subchannels: z.array(z.string()),
  }),
);
export type ChannelGroup = z.infer<typeof channelGroupsSchema>[number];
const nullableText = z.string().nullable();
export const promoteRecordSchema = z.looseObject({
  id: z.number().int(),
  articleId: z.number().int().nullable(),
  channel: nullableText,
  subChannel: nullableText,
  title: nullableText,
  smallText: nullableText,
  writer: nullableText,
  titlePic: nullableText,
  titlePic2: nullableText,
  host: nullableText,
  url: nullableText,
  landUrl: nullableText,
  publishDate: nullableText,
  order: z.number().int().nullable(),
  createdAt: nullableText,
  updatedAt: nullableText,
  deletedAt: nullableText,
});
export type PromoteRecord = z.infer<typeof promoteRecordSchema>;
export type PromoteField = keyof typeof promoteRecordSchema.shape;
export const promotePageSchema = z.object({
  data: z.array(promoteRecordSchema),
  total: z.number().int().nonnegative(),
  current: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type PromotePage = z.infer<typeof promotePageSchema>;
export const pageSizes = [10, 20, 30, 50] as const;
export const promoteQuerySchema = z
  .object({
    channel: z.string(),
    subchannel: z.string(),
    publishdate: z.union([z.literal(""), z.iso.date()]),
    current: z.number().int().positive().max(4_294_967_295),
    pagesize: z.union([
      z.literal(10),
      z.literal(20),
      z.literal(30),
      z.literal(50),
    ]),
  })
  .refine((q) => q.channel !== "" || q.subchannel === "", "请先选择渠道");
export type PromoteQuery = z.infer<typeof promoteQuerySchema>;

export const promoteImageSchema = z.object({
  mimeType: z.string().regex(/^image\/[a-z0-9.+-]+$/i),
  byteSize: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024),
  dataBase64: z
    .string()
    .min(1)
    .max(4 * Math.ceil((20 * 1024 * 1024) / 3)),
});
export type PromoteImagePayload = z.infer<typeof promoteImageSchema>;

export const promoteInputSchema = z.object({
  channel: z.string().refine((v) => !!v.trim(), "Channel 必填"),
  subChannel: nullableText,
  publishDate: z.union([z.literal(""), z.iso.date(), z.null()]),
  url: nullableText,
  title: z.string().refine((v) => !!v.trim(), "Title 必填"),
  titlePic: z.string().refine((v) => !!v.trim(), "TitlePic 必填"),
  titlePic2: nullableText,
  smallText: nullableText,
  writer: nullableText,
});
export type PromoteInput = z.infer<typeof promoteInputSchema>;
export const mutationResultSchema = z.object({ succeeded: z.literal(true) });
export const uploadedImageSchema = z.object({ url: z.string().min(1) });
export const uploadRequestSchema = promoteImageSchema
  .pick({ mimeType: true, dataBase64: true })
  .extend({ fileName: z.string().min(1).max(255) });
export type UploadImageRequest = z.infer<typeof uploadRequestSchema>;
