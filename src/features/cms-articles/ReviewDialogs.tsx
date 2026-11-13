import { useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { isAndroid } from "@/lib/platform";
import type { CmsArticleRow } from "@/types/cms-article";
import { previewHtml } from "./editor-content";
import type { ArticleReviewController } from "./use-article-review";

const statuses = {
  succeeded: "成功",
  failed: "失败",
  unconfirmed: "结果待确认",
  notAttempted: "未执行",
};
function ReviewArticleList({ rows }: { rows: CmsArticleRow[] }) {
  return (
    <ol className="article-review-list" aria-label="待审核文章">
      {rows.map((row, index) => (
        <li key={row.id}>
          <span className="article-review-ordinal">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div>
            <h3>{row.title || "未命名文章"}</h3>
            <p className="article-review-meta">
              <span>#{row.id}</span>
              <span>{row.className || "未分类"}</span>
              <span>
                {row.pages === null ? "分页未设置" : `${row.pages} 页`}
              </span>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
export function ReviewDialogs({
  review: r,
  onResumeDraft,
  onDiscardDraft,
}: {
  review: ArticleReviewController;
  onResumeDraft: () => void;
  onDiscardDraft: () => void;
}) {
  const [discard, setDiscard] = useState(false);
  const reviewTrigger = useRef<HTMLElement | null>(null);
  const decisionTrigger = useRef<HTMLElement | null>(null);
  function restoreTrigger(trigger: HTMLElement | null) {
    const destination =
      trigger?.isConnected && !trigger.hasAttribute("disabled")
        ? trigger
        : document.querySelector<HTMLElement>('[aria-label="全选当前页文章"]');
    destination?.focus({ preventScroll: true });
  }
  function restoreReviewFocus(event: Event) {
    event.preventDefault();
    if (!r.resultOpen) restoreTrigger(reviewTrigger.current);
  }
  const content = (
    <>
      {r.loading ? (
        <Skeleton className="h-32" aria-label="正在读取审核详情" />
      ) : r.target?.detail ? (
        <article
          className="cms-editor-body break-words"
          aria-label="审核正文预览"
        >
          <h2 className="mb-4">{r.target.detail.title || "未命名文章"}</h2>
          <div
            dangerouslySetInnerHTML={{
              __html: previewHtml(r.target.detail.newsText),
            }}
          />
        </article>
      ) : (
        <>
          <div className="article-review-list-label">
            <span>本次审核稿件</span>
            <span>{r.target?.rows.length ?? 0} 篇</span>
          </div>
          <ReviewArticleList rows={r.target?.rows ?? []} />
          <Alert className="article-review-note">
            <AlertTitle>按后台已保存内容审核</AlertTitle>
            <AlertDescription>请核对本次稿件，再选择审核意见</AlertDescription>
          </Alert>
        </>
      )}
      {r.error && (
        <Alert variant="destructive">
          <AlertTitle>审核提示</AlertTitle>
          <AlertDescription>{r.error}</AlertDescription>
        </Alert>
      )}
    </>
  );
  const buttons = (
    <>
      {r.target?.single && (
        <Button
          variant="outline"
          disabled={r.busy || r.loading}
          onClick={r.close}
        >
          关闭
        </Button>
      )}
      <Button
        variant="outline"
        className="article-review-reject"
        disabled={
          r.busy || r.loading || (!!r.target?.single && !r.target.detail)
        }
        onClick={() => r.setDecision("reject")}
      >
        拒绝
      </Button>
      <Button
        disabled={
          r.busy || r.loading || (!!r.target?.single && !r.target.detail)
        }
        onClick={() => r.setDecision("accept")}
      >
        同意
      </Button>
    </>
  );
  const title = r.target?.single ? "审核文章" : "批量审核";
  return (
    <>
      {isAndroid() && r.target?.single ? (
        <Dialog open={!!r.target} onOpenChange={(open) => !open && r.close()}>
          <DialogContent
            data-article-dialog="review"
            showCloseButton={false}
            onOpenAutoFocus={() => {
              reviewTrigger.current = document.activeElement as HTMLElement;
            }}
            onCloseAutoFocus={restoreReviewFocus}
            onEscapeKeyDown={(e) => r.busy && e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                审核 CMS 已保存内容；审核结果以后台确认为准。
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="min-h-0 flex-1">
              <div className="article-review-body">{content}</div>
            </ScrollArea>
            <DialogFooter className="article-review-footer">
              {buttons}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : (
        <Sheet open={!!r.target} onOpenChange={(open) => !open && r.close()}>
          <SheetContent
            side={isAndroid() ? "bottom" : "right"}
            className={
              r.target?.single
                ? "article-review-sheet"
                : "article-review-batch-sheet"
            }
            data-article-dialog={r.target?.single ? "review" : "review-batch"}
            showCloseButton={false}
            onOpenAutoFocus={() => {
              reviewTrigger.current = document.activeElement as HTMLElement;
            }}
            onCloseAutoFocus={restoreReviewFocus}
            onInteractOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => r.busy && e.preventDefault()}
          >
            <SheetHeader className="article-review-header">
              <div>
                <SheetTitle>{title}</SheetTitle>
                <SheetDescription>
                  {r.target?.single
                    ? "审核 CMS 已保存内容；审核结果以后台确认为准"
                    : `已选 ${r.target?.rows.length ?? 0} 篇 · 请核对本次稿件`}
                </SheetDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                disabled={r.busy || r.loading}
                onClick={r.close}
                aria-label="关闭审核"
              >
                <X />
              </Button>
            </SheetHeader>
            <ScrollArea className="min-h-0 flex-1">
              <div className="article-review-body">{content}</div>
            </ScrollArea>
            <SheetFooter className="article-review-footer">
              {buttons}
            </SheetFooter>
          </SheetContent>
        </Sheet>
      )}
      <Dialog
        open={!!r.decision}
        onOpenChange={(open) => !open && r.setDecision(null)}
      >
        <DialogContent
          data-article-dialog="review-confirm"
          className="article-review-confirm"
          showCloseButton={false}
          onOpenAutoFocus={() => {
            decisionTrigger.current = document.activeElement as HTMLElement;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (r.target && !r.resultOpen)
              restoreTrigger(decisionTrigger.current);
          }}
          onEscapeKeyDown={(e) => r.busy && e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              {r.decision === "accept" ? "确认通过审核？" : "确认拒绝稿件？"}
            </DialogTitle>
            <DialogDescription>
              本次处理 {r.target?.rows.length ?? 0} 篇文章。提交后不会自动重试。
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="min-h-0 max-h-[40dvh]">
            <ReviewArticleList rows={r.target?.rows ?? []} />
          </ScrollArea>
          {r.error && (
            <p role="alert" className="text-destructive">
              {r.error}
            </p>
          )}
          <DialogFooter className="article-review-confirm-footer">
            <Button
              variant="outline"
              disabled={r.busy}
              onClick={() => r.setDecision(null)}
            >
              取消
            </Button>
            <Button
              variant={
                r.decision === "reject" ? "destructive-solid" : "default"
              }
              disabled={r.busy}
              onClick={() => void r.submit()}
            >
              {r.busy
                ? "正在审核…"
                : r.decision === "reject"
                  ? "确认拒绝"
                  : "确认同意"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={r.resultOpen}
        onOpenChange={(open) => !open && r.closeResults()}
      >
        <DialogContent
          data-article-dialog="review-results"
          className="article-review-results"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreTrigger(reviewTrigger.current);
          }}
        >
          <DialogHeader>
            <DialogTitle>审核结果</DialogTitle>
            <DialogDescription>
              {Object.entries(statuses)
                .map(
                  ([key, name]) =>
                    `${name} ${r.summary?.items.filter((item) => item.status === key).length ?? 0}`,
                )
                .join(" · ")}
            </DialogDescription>
          </DialogHeader>
          {r.summary?.items.some((item) => item.status === "unconfirmed") && (
            <p role="alert" className="text-sm text-destructive">
              结果待确认的文章须先关闭此窗口，点击“刷新”核对列表，再决定是否重新审核。
            </p>
          )}
          <ScrollArea className="min-h-0 max-h-[60dvh] flex-1">
            <ul className="flex flex-col gap-3 p-1" aria-label="逐篇审核结果">
              {r.summary?.items.map((item) => (
                <li key={item.id}>
                  <p>
                    #{item.id} · {item.title || "未命名文章"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {statuses[item.status]} · {item.message}
                  </p>
                </li>
              ))}
            </ul>
          </ScrollArea>
          <DialogFooter>
            <Button onClick={r.closeResults}>关闭结果</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!r.blockedDraft}
        onOpenChange={(open) => {
          if (!open) {
            r.setBlockedDraft(undefined);
            setDiscard(false);
          }
        }}
      >
        <DialogContent data-article-dialog="review-draft">
          <DialogTitle>
            {discard ? "确认放弃未保存草稿？" : "请先处理未保存草稿"}
          </DialogTitle>
          <DialogDescription>
            {discard
              ? "草稿将被清除，CMS 中已保存的内容不受影响。放弃后请重新点击审核。"
              : "本次文章中存在未保存的文章或转素材草稿，请先保存或明确放弃，再进入审核。"}
          </DialogDescription>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                r.setBlockedDraft(undefined);
                setDiscard(false);
              }}
            >
              取消
            </Button>
            {discard ? (
              <Button
                variant="destructive"
                onClick={() => {
                  onDiscardDraft();
                  setDiscard(false);
                }}
              >
                确认放弃草稿
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setDiscard(true)}>
                  放弃草稿
                </Button>
                <Button onClick={onResumeDraft}>继续编辑草稿</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
