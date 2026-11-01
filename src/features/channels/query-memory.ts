import type { PromoteQuery } from "@/types/cms";
import { appQueryRuntime, channelFilterAtom } from "@/lib/query-runtime";

// 仅保留本次运行的已提交查询；认证失效时保留，同账号重新登录继续使用。
let owner: number | null = null;
export const channelQueryMemory = {
  read: () => appQueryRuntime.store.get(channelFilterAtom),
  remember(query: PromoteQuery) {
    appQueryRuntime.store.set(channelFilterAtom, { ...query });
  },
  retainUser(userId: number) {
    if (owner !== null && owner !== userId)
      appQueryRuntime.store.set(channelFilterAtom, null);
    owner = userId;
  },
  clear() {
    owner = null;
    appQueryRuntime.store.set(channelFilterAtom, null);
  },
};
