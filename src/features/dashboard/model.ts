import type { HarvestJob } from "@/features/import/contracts";
import {
  articleQueryParams,
  defaultQuery,
} from "@/features/cms-articles/service";
import type { ReviewView } from "@/types/cms-article";

export const reviewViews = ["review-1", "review-2", "review-3"] as const;

export function summarizeHarvest(jobs: HarvestJob[]) {
  const formal = jobs.filter(
    (job) => !job.developerMode && job.status !== "debugCompleted",
  );
  return {
    today: formal.length,
    succeeded: formal.filter((job) => job.status === "succeeded").length,
    active: formal.filter((job) => ["queued", "running"].includes(job.status))
      .length,
    attention: formal.filter((job) =>
      [
        "waitingUser",
        "waitingLogin",
        "failed",
        "interrupted",
        "submissionUnknown",
      ].includes(job.status),
    ).length,
    recent: [...formal]
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
      )
      .slice(0, 5),
  };
}

export function reviewOverviewQuery(view: ReviewView) {
  return { ...defaultQuery(view), pagesize: 10 as const };
}

export function reviewOverviewLink(view: ReviewView) {
  return `/articles/${view}?${articleQueryParams(defaultQuery(view))}`;
}

export function harvestBadgeVariant(status: HarvestJob["status"]) {
  if (status === "succeeded") return "success";
  if (["failed", "submissionUnknown"].includes(status)) return "destructive";
  if (
    ["running", "waitingUser", "waitingLogin", "interrupted"].includes(status)
  )
    return "warning";
  return "secondary";
}
