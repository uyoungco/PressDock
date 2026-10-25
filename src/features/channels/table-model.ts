import type { PromoteField } from "@/types/cms";
import type { PreferenceColumn } from "@/hooks/use-column-preferences";

export const materialColumns: [PromoteField, string][] = [
  ["id", "素材编号"],
  ["articleId", "文章编号"],
  ["writer", "作者"],
  ["publishDate", "发布日期"],
  ["channel", "渠道"],
  ["subChannel", "子渠道"],
  ["title", "标题"],
  ["titlePic", "主图"],
  ["titlePic2", "第二张图片"],
  ["smallText", "摘要"],
  ["host", "主机"],
  ["url", "文章链接"],
  ["landUrl", "落地链接"],
  ["createdAt", "创建时间"],
  ["updatedAt", "更新时间"],
  ["deletedAt", "删除时间"],
  ["order", "排序值"],
];
export const articleUrl = (id: number | null) =>
  id !== null && Number.isSafeInteger(id) && id > 0
    ? `https://mini.jnnc.com/h/${id}.html?zn=mr`
    : null;

const widths: Partial<Record<PromoteField, [number, number]>> = {
  id: [80, 64],
  articleId: [112, 96],
  title: [320, 224],
  titlePic: [160, 160],
  titlePic2: [160, 160],
  smallText: [272, 144],
  url: [256, 160],
  landUrl: [256, 160],
  subChannel: [208, 144],
  publishDate: [176, 128],
  createdAt: [176, 128],
  updatedAt: [176, 128],
  deletedAt: [176, 128],
};
export const materialColumnPreferences: PreferenceColumn[] = [
  ...materialColumns.map(([id, label]) => ({
    id,
    label,
    size: widths[id]?.[0] ?? 144,
    minSize: widths[id]?.[1] ?? 96,
    maxSize: 960,
    enableHiding: id !== "title",
  })),
  {
    id: "actions",
    label: "操作",
    size: 192,
    minSize: 176,
    maxSize: 400,
    enableHiding: false,
  },
];
