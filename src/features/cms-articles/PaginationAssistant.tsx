import { ScrollArea } from "@/components/ui/scroll-area";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { pagePreview, readPagination } from "./editor-pagination";
import { preparePagination, buildPagination } from "./ai-pagination";
import { aiService } from "@/features/ai/service";
import { emptySettings } from "@/features/ai/contracts";
import { aiErrorMessage } from "@/features/ai/use-settings";
import { onClientInvalidated } from "@/services/tauri/client";
import { useNavigate } from "react-router-dom";

export function PaginationAssistant({
  doc,
  title,
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
  title: string;
  locked: boolean;
  canInsert: boolean;
  onInsert: () => void;
  onRemove: (index: number) => void;
  onApply: (base: Node, candidate: Node) => void;
  onLocate: (position: number) => void;
  onClose: () => void;
  onAfterClose: () => void;
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<{
    base: Node;
    title: string;
    candidate: Node;
    oversized: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  const [settings, setSettings] = useState(emptySettings);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const latest = useRef({ doc, title, locked });
  const valid = useRef(true);
  useEffect(() => {
    latest.current = { doc, title, locked };
  }, [doc, title, locked]);
  useEffect(() => {
    valid.current = true;
    let active = true;
    aiService
      .load()
      .then((data) => {
        if (!active) return;
        setSettings(data);
      })
      .catch((reason) => {
        if (active) setError(aiErrorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const unsubscribe = onClientInvalidated(() => {
      valid.current = false;
      controller.current?.abort();
      setDraft(null);
      setBusy(false);
    });
    return () => {
      active = false;
      valid.current = false;
      controller.current?.abort();
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    controller.current?.abort();
    setBusy(false);
  }, [doc, title, locked]);
  const template = settings.templates.find(
    (t) => t.purpose === "pagination" && t.isDefault,
  );
  const model = settings.models.find((m) => m.id === template?.modelConfigId);
  const configured = !!template?.paginationOptions && !!model;
  const configurationIssue = !template
    ? "尚未设置默认文章分页模板，请到设置中指定默认模板。"
    : !template.paginationOptions
      ? "默认文章分页模板缺少页长参数，请到设置中补全。"
      : !model
        ? "默认文章分页模板尚未绑定有效模型，请到设置中绑定已保存的 AI 模型。"
        : "";
  // 文档引用变化即使初稿失效，选区/翻页变化不影响初稿，也不创建另一份编辑状态。
  const stale = !!draft && (draft.base !== doc || draft.title !== title);
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
  async function generate() {
    if (
      locked ||
      busy ||
      !valid.current ||
      !configured ||
      !model ||
      !template?.paginationOptions
    )
      return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError("");
    try {
      const prepared = preparePagination(doc);
      const response = prepared.hasText
        ? await aiService.paginate(
            {
              title,
              blocks: prepared.blocks,
              templateId: template.id,
              modelConfigId: model.id,
            },
            current.signal,
          )
        : { breakAfter: [], paginationOptions: template.paginationOptions };
      if (
        current.signal.aborted ||
        !valid.current ||
        latest.current.doc !== doc ||
        latest.current.title !== title ||
        latest.current.locked
      )
        return;
      const result = buildPagination(
        prepared,
        response.breakAfter,
        response.paginationOptions,
      );
      setDraft({ base: doc, title, ...result });
      setSelected(0);
    } catch (reason) {
      if (!current.signal.aborted && valid.current)
        setError(aiErrorMessage(reason));
    } finally {
      if (controller.current === current && valid.current) setBusy(false);
    }
  }
  function close() {
    controller.current?.abort();
    onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
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
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-3">
            {loading && (
              <p role="status" className="text-sm text-muted-foreground">
                正在读取默认分页配置…
              </p>
            )}
            {!loading && !configured && !error && (
              <Alert>
                <InfoIcon />
                <AlertTitle>需要配置 AI 分页</AlertTitle>
                <AlertDescription>
                  <p>{configurationIssue}</p>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    onClick={() => {
                      close();
                      navigate("/settings?tab=ai-templates&purpose=pagination");
                    }}
                  >
                    配置默认分页模板
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={locked || busy || previewing || !canInsert}
                onClick={onInsert}
              >
                在当前段落后分页
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={locked || nested || loading || busy || !configured}
                onClick={generate}
              >
                {busy ? "正在生成分页…" : "AI 生成分页"}
              </Button>
              {busy && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    controller.current?.abort();
                    setBusy(false);
                  }}
                >
                  取消生成
                </Button>
              )}
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
                  可能在完整句末拆分长段，可一次撤销恢复。
                  {draft?.oversized &&
                    "存在不可拆内容，部分页面超过建议字数，请核对。"}
                </AlertDescription>
              </Alert>
            )}
            {draft && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={locked || busy || stale}
                  onClick={() => {
                    if (
                      !locked &&
                      !busy &&
                      draft.base === doc &&
                      draft.title === title
                    ) {
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
                    controller.current?.abort();
                    setBusy(false);
                    setDraft(null);
                    setError("");
                    setSelected(0);
                  }}
                >
                  取消初稿
                </Button>
              </div>
            )}
            <ScrollArea className="max-h-32">
              <nav aria-label="正文页码" className="flex flex-wrap gap-1">
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
            </ScrollArea>
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
        </ScrollArea>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={locked || busy || previewing || nested || index === 0}
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
            disabled={
              locked || busy || previewing || nested || index >= breaks.length
            }
            onClick={() => onRemove(index)}
          >
            删除当前页后分页点
          </Button>
          <Button type="button" variant="outline" onClick={close}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
