import type { PropsWithChildren } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogFooter,
} from "@/components/ui/dialog";
import { useMobileSettings } from "./mobile-state";

// 三类设置编辑共用手机容器，桌面仍渲染原来的 Card 和内联表单。
export function MobileEditor({
  title,
  formId,
  busy,
  error,
  children,
}: PropsWithChildren<{
  title: string;
  formId: string;
  busy: boolean;
  error: string | null;
}>) {
  const mobile = useMobileSettings()!;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) mobile.closeEditor();
      }}
    >
      <DialogContent
        data-settings-dialog="editor"
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="返回列表"
              disabled={busy}
              onClick={mobile.closeEditor}
            >
              <ArrowLeft data-icon="inline-start" />
            </Button>
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription>
            返回会保留输入，点击保存后生效。
          </DialogDescription>
        </DialogHeader>
        <div
          data-settings-body
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          {children}
        </div>
        {error && (
          <p
            role="alert"
            className="max-h-24 shrink-0 overflow-y-auto text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={mobile.closeEditor}
          >
            返回列表
          </Button>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? "正在保存…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
