import { z } from "zod";

// 五项处理设置随任务入队固定；保留天数只属于应用级清理规则。
export const harvestSettingsSchema = z.object({
  developerMode: z.boolean().default(false),
  autoClassify: z.boolean(),
  autoTags: z.boolean(),
  autoSummary: z.boolean(),
  autoOrganize: z.boolean(),
  autoPaginate: z.boolean(),
  modelConfigId: z.string().min(1).max(100).nullable(),
  retentionDays: z.number().int().min(1).max(36500).nullable(),
});
export type HarvestSettings = z.infer<typeof harvestSettingsSchema>;
export const harvestJobSchema = z.object({
  developerMode: z.boolean().default(false),
  id: z.uuid(),
  url: z.url({ protocol: /^https?$/ }),
  title: z.string().nullable(),
  collectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum([
    "queued",
    "running",
    "waitingUser",
    "waitingLogin",
    "succeeded",
    "debugCompleted",
    "failed",
    "cancelled",
    "interrupted",
    "submissionUnknown",
  ]),
  stage: z
    .enum([
      "collecting",
      "formatting",
      "metadata",
      "organizing",
      "paginating",
      "submitting",
    ])
    .nullable(),
  warnings: z.string().array(),
  error: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  cmsArticleId: z.string().nullable(),
});
export type HarvestJob = z.infer<typeof harvestJobSchema>;
export const harvestListSchema = z.object({
  jobs: harvestJobSchema.array(),
  maintenanceWarning: z.string().nullable(),
});
export const harvestActionSchema = z.enum([
  "resume",
  "show",
  "cancel",
  "retry",
  "confirmSubmitted",
  "confirmNotSubmitted",
  "delete",
]);
export type HarvestAction = z.infer<typeof harvestActionSchema>;
export function localCollectionDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function statusText(job: HarvestJob): string {
  if (job.status === "running") {
    return job.stage
      ? {
          collecting: "采集中",
          formatting: "格式化中",
          metadata: "生成元数据中",
          organizing: "整理正文中",
          paginating: "内容分页中",
          submitting: "提交 CMS 中",
        }[job.stage]
      : "处理中";
  }
  return {
    queued: "排队中",
    waitingUser: "等待网页验证",
    waitingLogin: "等待重新登录",
    succeeded: "已添加到 CMS",
    debugCompleted: "调试完成，未提交 CMS",
    failed: "失败",
    cancelled: "已取消",
    interrupted: "已中断",
    submissionUnknown: "提交结果待确认",
  }[job.status];
}

export function harvestStatus(job: HarvestJob): string {
  const text = statusText(job);
  return job.developerMode && job.status !== "debugCompleted"
    ? `${text}（开发调试）`
    : text;
}

export const harvestDiagnosticSchema = z.object({
  operation: z.string(),
  causes: z.string().array(),
  context: z.unknown(),
});

// 只接收 Rust 主窗口的业务日志，正文作为数据打印，不作为 HTML 执行。
export const harvestDebugSchema = z.object({
  userId: z.number().int(),
  jobId: z.uuid(),
  attempt: z.number().int().nonnegative(),
  timestamp: z.iso.datetime(),
  step: z.string().min(1),
  kind: z.enum(["input", "output", "skip", "error", "state"]),
  data: z.unknown(),
  diagnostic: harvestDiagnosticSchema.nullable().optional(),
});
export type HarvestDebugEvent = z.infer<typeof harvestDebugSchema>;
