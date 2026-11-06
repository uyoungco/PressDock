import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  harvestStatus,
  type HarvestAction,
  type HarvestJob,
} from "./contracts";
import { importService } from "./service";
import type { HarvestConfirmation } from "./table-model";

function openSource(job: HarvestJob) {
  void importService
    .openSource(job.url)
    .catch((reason: unknown) =>
      toast.error(
        reason instanceof Error ? reason.message : "打开原文失败，请重试",
      ),
    );
}

export function ImportTitle({ job }: { job: HarvestJob }) {
  const created = new Date(job.createdAt);
  return (
    <div className="min-w-0">
      <a
        href={job.url}
        title={job.title || job.url}
        className="import-title block truncate font-medium hover:underline"
        onClick={(event) => {
          event.preventDefault();
          openSource(job);
        }}
      >
        {job.title || job.url}
      </a>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span title={job.url} className="min-w-0 break-all">
          {new URL(job.url).hostname}
        </span>
        <span aria-hidden>·</span>
        <time
          dateTime={job.createdAt}
          title={created.toLocaleString("zh-CN", { hour12: false })}
          className="tabular-nums"
        >
          {created.toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })}
        </time>
      </div>
    </div>
  );
}

export function ImportStatus({ job }: { job: HarvestJob }) {
  return (
    <div className="flex flex-col gap-1" data-import-status={job.status}>
      <span className="import-status flex items-center gap-1.5">
        {harvestStatus(job)}
      </span>
      {job.error && (
        <p className="import-status-note text-xs break-words text-muted-foreground">
          {job.error}
        </p>
      )}
      {job.warnings.map((warning, index) => (
        <p
          key={index}
          className="import-status-note text-xs break-words text-muted-foreground"
        >
          {warning}
        </p>
      ))}
    </div>
  );
}

export function ImportActions({
  job,
  disabled,
  onAction,
  onSelect,
  onConfirm,
}: {
  job: HarvestJob;
  disabled: boolean;
  onAction: (job: HarvestJob, action: HarvestAction) => Promise<boolean>;
  onSelect: (job: HarvestJob) => void;
  onConfirm: (job: HarvestJob, action: HarvestConfirmation) => void;
}) {
  const waiting = job.status === "waitingUser";
  const terminal = [
    "succeeded",
    "debugCompleted",
    "failed",
    "cancelled",
    "interrupted",
  ].includes(job.status);
  return (
    <div className="import-actions flex flex-wrap items-center justify-end gap-1.5">
      {waiting &&
        (job.sourceInteraction?.kind === "selectTab" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onSelect(job)}
          >
            选择标签页
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              aria-label={
                job.sourceMode === "cdp" ? "打开浏览器标签页" : "打开来源窗口"
              }
              onClick={() => void onAction(job, "show")}
            >
              打开来源
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => void onAction(job, "resume")}
            >
              验证完成，继续
            </Button>
          </>
        ))}
      {["queued", "running"].includes(job.status) && (
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => void onAction(job, "cancel")}
        >
          取消
        </Button>
      )}
      {["failed", "interrupted", "cancelled", "waitingLogin"].includes(
        job.status,
      ) && (
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => void onAction(job, "retry")}
        >
          重试
        </Button>
      )}
      {job.status === "submissionUnknown" && (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onConfirm(job, "confirmSubmitted")}
          >
            CMS 已添加
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onConfirm(job, "confirmNotSubmitted")}
          >
            CMS 未添加
          </Button>
        </>
      )}
      {(waiting || terminal) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label={`${job.title || job.url}，更多操作`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => openSource(job)}>
                打开原文
              </DropdownMenuItem>
              {waiting && (
                <DropdownMenuItem onSelect={() => void onAction(job, "cancel")}>
                  取消任务
                </DropdownMenuItem>
              )}
              {terminal && (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => onConfirm(job, "delete")}
                >
                  删除记录
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
