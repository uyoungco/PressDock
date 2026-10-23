export interface PublishJob {
  id: string;
  articleId: string;
  status: "queued" | "running" | "failed" | "completed";
  error?: string;
  isDemo: boolean;
}
export const demoPublishJobs: PublishJob[] = [
  {
    id: "demo-job-1",
    articleId: "demo-2",
    status: "failed",
    error: "演示错误：CMS 发布接口尚未接入，未执行发布。",
    isDemo: true,
  },
];
