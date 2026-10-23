import {
  authSessionSchema,
  channelGroupsSchema,
  loginInputSchema,
  logoutResultSchema,
  promotePageSchema,
  promoteQuerySchema,
  promoteImageSchema,
  type LoginInput,
  type PromoteQuery,
  type PromoteInput,
  type PromoteRecord,
  type UploadImageRequest,
  promoteInputSchema,
  promoteRecordSchema,
  mutationResultSchema,
  uploadedImageSchema,
  uploadRequestSchema,
} from "@/types/cms";
import { z } from "zod";
import { invokeCommand } from "./client";

export const cmsIpc = {
  login: (request: LoginInput) =>
    invokeCommand("cms_login", authSessionSchema, {
      request: loginInputSchema.parse(request),
    }),
  restore: () =>
    invokeCommand("cms_restore_session", authSessionSchema.nullable()),
  logout: () => invokeCommand("cms_logout", logoutResultSchema),
  channels: () =>
    invokeCommand("cms_list_promote_channels", channelGroupsSchema),
  list: (query: PromoteQuery) =>
    invokeCommand("cms_list_promote_data", promotePageSchema, {
      query: promoteQuerySchema.parse(query),
    }),
  image: (url: string) =>
    invokeCommand("cms_load_promote_image", promoteImageSchema, { url }),
  get: (id: number) =>
    invokeCommand("cms_get_promote_data", promoteRecordSchema, {
      id: z.number().int().positive().safe().parse(id),
    }),
  create: (input: PromoteInput) =>
    invokeCommand("cms_create_promote_data", mutationResultSchema, {
      input: promoteInputSchema.parse(input),
    }),
  update: (record: PromoteRecord) =>
    invokeCommand("cms_update_promote_data", mutationResultSchema, {
      record: promoteRecordSchema.parse(record),
    }),
  remove: (id: number) =>
    invokeCommand("cms_delete_promote_data", mutationResultSchema, {
      id: z.number().int().positive().safe().parse(id),
    }),
  order: (query: PromoteQuery, ids: number[]) =>
    invokeCommand("cms_save_promote_order", mutationResultSchema, {
      query: promoteQuerySchema.parse(query),
      ids: z
        .array(z.number().int().positive().safe())
        .min(2)
        .max(50)
        .parse(ids),
    }),
  upload: (input: UploadImageRequest) =>
    invokeCommand(
      "cms_upload_promote_image",
      uploadedImageSchema,
      uploadRequestSchema.parse(input),
    ),
  openLink: (url: string) =>
    invokeCommand("open_external_link", z.null(), { url }),
};
