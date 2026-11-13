import type {
  ArticleReviewSummary,
  CmsArticleDetail,
} from "@/types/cms-article";

export const reviewArticle = (id = 8101): CmsArticleDetail => ({
  id,
  title: `【演示数据】待审核文章 ${id}`,
  classId: 1,
  className: "演示分类",
  writer: null,
  titlePic: null,
  titlePic2: null,
  titlePic3: null,
  sourceUrl: null,
  smallText: "仅用于本地隔离验收，不连接真实 CMS。",
  newsTime: null,
  pages: 2,
  tags: ["演示"],
  nTags: [],
  commentRecommand: "",
  commentPromote: [],
  snapshot: {
    Id: id,
    Title: `【演示数据】待审核文章 ${id}`,
    Tags: '["演示"]',
    NTags: null,
  },
  newsText:
    '<p style="color:red">【演示数据】CMS 已保存原文 &amp; 正文。</p><script>window.reviewUnsafe=true</script><p onclick="alert(1)">第二段</p><a href="javascript:alert(1)">危险链接</a>',
  status: 0,
  updatedAt: null,
});
export const reviewSummary = (ids = [8101]): ArticleReviewSummary => ({
  authExpired: false,
  items: ids.map((id) => ({
    id,
    title: reviewArticle(id).title,
    status: "succeeded",
    code: null,
    message: "【演示结果】审核通过，未请求真实 CMS",
  })),
});
