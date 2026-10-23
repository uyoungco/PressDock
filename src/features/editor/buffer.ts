// 未保存编辑只留在进程内；按已认证用户隔离，不写入 Web Storage。
type EditBuffer = { title: string; content: string };
const buffers = new Map<string, EditBuffer>();
const key = (userId: number, articleId: string) => `${userId}:${articleId}`;
export const editorBuffers = {
  get: (userId: number, articleId: string) =>
    buffers.get(key(userId, articleId)),
  set: (userId: number, articleId: string, value: EditBuffer) =>
    buffers.set(key(userId, articleId), value),
  remove: (userId: number, articleId: string) =>
    buffers.delete(key(userId, articleId)),
  clear: () => buffers.clear(),
  retainUser: (userId: number) => {
    for (const entry of buffers.keys())
      if (!entry.startsWith(`${userId}:`)) buffers.delete(entry);
  },
};
