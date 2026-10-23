import type { PromoteQuery } from "@/types/cms";

// 仅保留本次运行的已提交查询；认证失效时保留，同账号重新登录继续使用。
let owner: number | null = null;
let submitted: PromoteQuery | null = null;
export const channelQueryMemory = {
  read: () => (submitted ? { ...submitted } : null),
  remember(query: PromoteQuery) {
    submitted = { ...query };
  },
  retainUser(userId: number) {
    if (owner !== null && owner !== userId) submitted = null;
    owner = userId;
  },
  clear() {
    owner = null;
    submitted = null;
  },
};
