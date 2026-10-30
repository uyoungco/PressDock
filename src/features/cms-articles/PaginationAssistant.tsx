import { useMemo, useState } from "react";
import type { Node } from "@tiptap/pm/model";
import { InfoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  automaticPagination,
  pagePreview,
  readPagination,
} from "./editor-pagination";

export function PaginationAssistant({
  doc,
  locked,
  canInsert,
  onInsert,
  onRemove,
  onApply,
  onLocate,
  onClose,
  onAfterClose,
}: {
  doc: Node;
  locked: boolean;
  canInsert: boolean;
  onInsert: () => void;
  onRemove: (index: number) => void;
  onApply: (base: Node, candidate: Node) => void;
  onLocate: (position: number) => void;
  onClose: () => void;
  onAfterClose: () => void;
}) {
  const [draft, setDraft] = useState<{ base: Node; candidate: Node } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  // 文档引用变化即使初稿失效，选区/翻页变化不影响初稿，也不创建另一份编辑状态。
  const stale = !!draft && draft.base !== doc;
  const candidate = draft && !stale ? draft.candidate : doc;
  const { pages, breaks } = useMemo(
    () => readPagination(candidate),
    [candidate],
  );
  const index = Math.min(selected, pages.length - 1);
  const current = pages[index];
  const html = useMemo(
    () => pagePreview(candidate, current.from, current.to),
    [candidate, current],
  );
  const nested = breaks.some((item) => item.nested);
  const previewing = !!draft && !stale;
  function generate() {
    if (locked) return;
    try {
      setDraft({ base: doc, candidate: automaticPagination(doc) });
      setError("");
      setSelected(0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法生成分页初稿");
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        id="cms-pagination-assistant"
        // Portal 脱离正文容器后仍需同一排版作用域，避免预览丢失图片尺寸和文字样式。
        className="cms-rich-editor flex max-h-[85dvh] flex-col sm:max-w-4xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onAfterClose();
        }}
      >
        <DialogHeader className="pr-8">
          <DialogTitle>
            分页助手 {previewing && <Badge variant="secondary">初稿预览</Badge>}
          </DialogTitle>
          <DialogDescription>
            共 {pages.length} 页。调整后仍需保存修改才写入
            CMS；关闭会丢弃尚未应用的初稿。
          </DialogDescription>
        </DialogHeader>
        {/* 滚动容器与内容布局分开，避免窄屏长预览被 flex 压缩后越过自身边框。 */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={locked || previewing || !canInsert}
                onClick={onInsert}
              >
                在当前段落后分页
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={locked || nested}
                onClick={generate}
              >
                自动分页初稿
              </Button>
            </div>
            {nested && (
              <Alert>
                <InfoIcon />
                <AlertTitle>存在嵌套分页</AlertTitle>
                <AlertDescription>
                  保留现有正文和分页预览。请先在 HTML
                  源码中调整为顶层分页，再使用分页调整。
                </AlertDescription>
              </Alert>
            )}
            {(error || stale) && (
              <p role="alert" className="text-sm text-destructive">
                {error || "正文已变化，分页初稿已失效，请重新生成。"}
              </p>
            )}
            {previewing && (
              <Alert>
                <InfoIcon />
                <AlertTitle>初稿尚未应用</AlertTitle>
                <AlertDescription>
                  {readPagination(doc).breaks.length
                    ? "应用将替换全部现有分页；"
                    : "应用后更新正文分页；"}
                  仅调整分页点，可一次撤销恢复。
                </AlertDescription>
              </Alert>
            )}
            {draft && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={locked || stale}
                  onClick={() => {
                    if (!locked && draft.base === doc) {
                      onApply(draft.base, draft.candidate);
                      setDraft(null);
                    }
                  }}
                >
                  应用初稿
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDraft(null);
                    setError("");
                    setSelected(0);
                  }}
                >
                  取消初稿
                </Button>
              </div>
            )}
            <nav
              aria-label="正文页码"
              className="flex max-h-32 flex-wrap gap-1 overflow-y-auto"
            >
              {pages.map((page, pageIndex) => (
                <Button
                  type="button"
                  key={pageIndex}
                  variant={pageIndex === index ? "secondary" : "outline"}
                  size="sm"
                  aria-current={pageIndex === index ? "page" : undefined}
                  onClick={() => setSelected(pageIndex)}
                >
                  第 {pageIndex + 1} 页 · {page.characters} 字
                </Button>
              ))}
            </nav>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={index === 0}
                onClick={() => setSelected(index - 1)}
              >
                上一页
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={index === pages.length - 1}
                onClick={() => setSelected(index + 1)}
              >
                下一页
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={locked || previewing}
                onClick={() => onLocate(current.from)}
              >
                定位正文
              </Button>
            </div>
            <p className="text-sm text-muted-foreground" role="status">
              第 {index + 1} / {pages.length} 页 · {current.characters}{" "}
              字（不含空白）
            </p>
            <div
              className="cms-editor-body cms-page-preview rounded-md border"
              aria-label={`第 ${index + 1} 页预览`}
              onClick={(event) => {
                if ((event.target as Element).closest("a"))
                  event.preventDefault();
              }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={locked || previewing || nested || index === 0}
            onClick={() => {
              onRemove(index - 1);
              setSelected(index - 1);
            }}
          >
            与上一页合并
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={locked || previewing || nested || index >= breaks.length}
            onClick={() => onRemove(index)}
          >
            删除当前页后分页点
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
