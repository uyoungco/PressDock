import { useRef, useState, type PropsWithChildren } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { focusOverlayContent } from "@/lib/overlay-focus";

export function SettingsEditorDialog({
  open,
  title,
  formId,
  busy,
  dirty,
  error,
  onClose,
  onDiscard,
  children,
}: PropsWithChildren<{
  open: boolean;
  title: string;
  formId: string;
  busy: boolean;
  dirty: boolean;
  error: string | null;
  onClose: () => void;
  onDiscard: () => void;
}>) {
  const [confirm, setConfirm] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  const close = () => {
    if (!busy) {
      if (dirty) setConfirm(true);
      else onClose();
    }
  };
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogContent
          ref={editor}
          showCloseButton={false}
          className="settings-dialog settings-editor-dialog"
          onOpenAutoFocus={(event) => {
            opener.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            focusOverlayContent(event);
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (opener.current?.isConnected)
              opener.current.focus({ preventScroll: true });
          }}
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <Button
            className="absolute top-2 right-2"
            size="icon-sm"
            variant="ghost"
            aria-label="关闭弹框"
            disabled={busy}
            onClick={close}
          >
            <X />
          </Button>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {formId === "settings-provider-form"
                ? "保存后生效，密钥仅由系统安全凭据库管理。"
                : "可选参数只在填写后发送，请按服务商说明设置。"}
            </DialogDescription>
          </DialogHeader>
          <div className="settings-dialog-body">{children}</div>
          {error && (
            <p role="alert" className="settings-dialog-error">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={close}>
              关闭
            </Button>
            <Button type="submit" form={formId} disabled={busy}>
              {busy
                ? "正在保存…"
                : formId === "settings-provider-form"
                  ? "保存提供商"
                  : "保存模型"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={open && confirm} onOpenChange={setConfirm}>
        <DialogContent
          className="settings-dialog"
          onOpenAutoFocus={focusOverlayContent}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = editor.current?.isConnected
              ? editor.current
              : opener.current;
            target?.focus({ preventScroll: true });
          }}
        >
          <DialogTitle>尚有未保存的修改</DialogTitle>
          <DialogDescription>
            可以保留草稿并返回列表，下次编辑时继续。草稿仅在当前设置会话内保留。
          </DialogDescription>
          <DialogFooter className="flex-wrap">
            <Button
              variant="ghost"
              onClick={() => {
                setConfirm(false);
                onDiscard();
                onClose();
              }}
            >
              丢弃修改
            </Button>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              继续编辑
            </Button>
            <Button
              onClick={() => {
                setConfirm(false);
                onClose();
              }}
            >
              保留草稿并关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
