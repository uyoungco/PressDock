import { cmsIpc } from "@/services/tauri/cms";
import {
  promoteQuerySchema,
  promoteInputSchema,
  type PromoteQuery,
  type PromoteInput,
  type PromoteRecord,
} from "@/types/cms";
import { prepareImageUpload } from "./upload";
import { onClientInvalidated, ServiceError } from "@/services/tauri/client";
export const channelService = {
  groups: () => cmsIpc.channels(),
  list: (query: PromoteQuery) => cmsIpc.list(promoteQuerySchema.parse(query)),
  get: (id: number) => cmsIpc.get(id),
  create: (input: PromoteInput) =>
    cmsIpc.create(promoteInputSchema.parse(input)),
  update: (record: PromoteRecord) => {
    promoteInputSchema.parse(record);
    return cmsIpc.update(record);
  },
  remove: (id: number) => cmsIpc.remove(id),
  order: (query: PromoteQuery, ids: number[]) => cmsIpc.order(query, ids),
  upload: async (file: File) => {
    let invalidated = false;
    const unsubscribe = onClientInvalidated(() => {
      invalidated = true;
    });
    try {
      const input = await prepareImageUpload(file);
      // 解码和读取也属于当前会话，避免换号后把旧文件提交给新账号。
      if (invalidated)
        throw new ServiceError("SESSION_CHANGED", "登录状态已变化，请重试");
      return await cmsIpc.upload(input);
    } finally {
      unsubscribe();
    }
  },
  openLink: (url: string) => cmsIpc.openLink(url),
};
export function readChannelQuery(params: URLSearchParams): PromoteQuery {
  const query = {
    channel: params.get("channel") ?? "",
    subchannel: params.get("subchannel") ?? "",
    publishdate: params.get("publishdate") ?? "",
    current: Number(params.get("current") ?? 1),
    pagesize: Number(params.get("pagesize") ?? 30),
  };
  const parsed = promoteQuerySchema.safeParse(query);
  return parsed.success
    ? parsed.data
    : {
        channel: "",
        subchannel: "",
        publishdate: "",
        current: 1,
        pagesize: 30,
      };
}
export function channelQueryParams(query: PromoteQuery) {
  return new URLSearchParams(
    Object.entries(query).map(([name, value]) => [name, String(value)]),
  );
}
