import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ArrowRight } from "lucide-react";
import type { CmsArticleRow } from "@/types/cms-article";
import type { ArticleReviewController } from "./use-article-review";

export function ReviewToolbar({
  review,
  rows,
  disabled,
  placement = "inline",
  showSelectAll = true,
}: {
  review: ArticleReviewController;
  rows: CmsArticleRow[];
  disabled: boolean;
  placement?: "inline" | "selection" | "dock";
  showSelectAll?: boolean;
}) {
  if (!review.allowed) return null;
  const selected = rows.filter((row) => review.selected.has(row.id));
  return (
    <div
      className="article-review-toolbar"
      data-placement={placement}
      aria-label={
        placement === "selection" ? "当前页选择工具栏" : "批量审核工具栏"
      }
    >
      {placement !== "dock" && showSelectAll && (
        <label className="article-review-select-all">
          <Checkbox
            aria-label="全选当前页文章"
            disabled={disabled || !rows.length}
            checked={
              selected.length === rows.length && rows.length > 0
                ? true
                : selected.length
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={(checked) =>
              checked ? review.selectAll(rows) : review.clearSelection()
            }
          />
          全选本页
        </label>
      )}
      {placement === "inline" && showSelectAll && (
        <Separator orientation="vertical" />
      )}
      {placement !== "selection" && (
        <div className="article-review-selection-summary">
          <p aria-label="已选文章数量">
            已选 <strong>{selected.length}</strong> 篇
          </p>
          {placement === "dock" && <span>仅处理当前页稿件</span>}
        </div>
      )}
      {placement !== "dock" && (
        <Button
          className="article-review-clear"
          aria-label="清空选择"
          variant="ghost"
          size="sm"
          disabled={disabled || !selected.length}
          onClick={review.clearSelection}
        >
          清空
        </Button>
      )}
      {placement !== "selection" && (
        <Button
          className="article-review-batch-button"
          size="sm"
          disabled={disabled || !selected.length}
          onClick={() => void review.begin(selected, false)}
        >
          批量审核
          <ArrowRight data-icon="inline-end" />
        </Button>
      )}
    </div>
  );
}
