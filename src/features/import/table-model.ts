import type { PreferenceColumn } from "@/hooks/use-column-preferences";
import type { HarvestJob } from "./contracts";

// 保留列 ID 与存储键；未调整过的列才使用新的布局宽度。
export const importColumns: PreferenceColumn[] = [
  {
    id: "title",
    label: "新闻内容",
    size: 176,
    minSize: 176,
    maxSize: 1400,
    enableHiding: false,
  },
  {
    id: "status",
    label: "状态",
    size: 248,
    minSize: 136,
    maxSize: 640,
    enableHiding: false,
  },
  {
    id: "actions",
    label: "操作",
    size: 272,
    minSize: 180,
    maxSize: 640,
    enableHiding: false,
  },
];

export const needsHarvestAttention = (job: HarvestJob) =>
  [
    "waitingUser",
    "waitingLogin",
    "failed",
    "interrupted",
    "submissionUnknown",
  ].includes(job.status);

export type HarvestConfirmation =
  "confirmSubmitted" | "confirmNotSubmitted" | "delete";
