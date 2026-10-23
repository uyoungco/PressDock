import type { AuthSession, PromotePage, PromoteRecord } from "@/types/cms";
export const session: AuthSession = {
  user: { userId: 6, nickname: "editor", roles: ["admin"], perms: ["admin"] },
  persistent: true,
};
export const material = (id = 1): PromoteRecord => ({
  id,
  articleId: 100 + id,
  title: `渠道新闻 ${id}`,
  channel: "KOOK",
  subChannel: "轮播图",
  writer: null,
  smallText: "这是摘要 <script>不会执行</script>",
  titlePic: null,
  titlePic2: "",
  host: null,
  url: "https://example.com/news",
  landUrl: "",
  publishDate: "2026-10-23",
  order: 1,
  createdAt: "2026-10-23T10:00:00",
  updatedAt: null,
  deletedAt: null,
});
export const materialPage = (
  count = 1,
  current = 1,
  pageSize = 30,
  total = count,
): PromotePage => ({
  data: Array.from({ length: count }, (_, i) => material(i + 1)),
  current,
  pageSize,
  total,
});
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
