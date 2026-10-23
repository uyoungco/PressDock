import type { PromoteField } from "@/types/cms";

export const materialColumns: [PromoteField, string][] = [
  ["id", "Id"],
  ["articleId", "ArticleId"],
  ["writer", "Writer"],
  ["publishDate", "PublishDate"],
  ["channel", "Channel"],
  ["subChannel", "SubChannel"],
  ["title", "Title"],
  ["titlePic", "TitlePic"],
  ["titlePic2", "TitlePic2"],
  ["smallText", "SmallText"],
  ["host", "Host"],
  ["url", "Url"],
  ["landUrl", "LandUrl"],
  ["createdAt", "CreatedAt"],
  ["updatedAt", "UpdatedAt"],
  ["deletedAt", "DeletedAt"],
  ["order", "Order"],
];
export const articleUrl = (id: number | null) =>
  id !== null && Number.isSafeInteger(id) && id > 0
    ? `https://mini.jnnc.com/h/${id}.html?zn=mr`
    : null;
