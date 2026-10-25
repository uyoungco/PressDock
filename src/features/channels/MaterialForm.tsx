import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMaterialImage } from "./use-material-image";
import type { MaterialEdit } from "./edit-buffer";
import type { PromoteInput } from "@/types/cms";

export function MaterialForm({
  edit,
  onChange,
  onClose,
  onSave,
  busy,
  onUploading,
  error,
}: {
  edit: MaterialEdit;
  onChange: (input: PromoteInput) => void;
  onClose: () => void;
  onSave: () => void;
  busy: boolean;
  onUploading: (value: boolean) => void;
  error: string | null;
}) {
  const image = useMaterialImage(edit.input, busy, onChange, onUploading);
  const fields: [keyof PromoteInput, string][] = [
    ["channel", "Channel"],
    ["subChannel", "SubChannel"],
    ["publishDate", "PublishDate"],
    ["url", "Url"],
    ["title", "Title"],
    ["titlePic", "TitlePic"],
    ["titlePic2", "TitlePic2"],
    ["smallText", "SmallText"],
    ["writer", "Writer"],
  ];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy && !image.working) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-2xl"
        showCloseButton={!busy && !image.working}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{edit.base ? "修改素材" : "新增素材"}</DialogTitle>
          <DialogDescription>
            带 * 的字段必填。上传图片只回填地址，保存后才关联素材。
          </DialogDescription>
        </DialogHeader>
        <form
          id="material-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!image.working && !busy) onSave();
          }}
          noValidate
          className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-1"
        >
          {fields.map(([field, label]) => (
            <div key={field} className="space-y-2">
              <label htmlFor={`material-${field}`} className="text-sm">
                {["channel", "title", "titlePic"].includes(field) ? "* " : ""}
                {label}
              </label>
              {field === "smallText" ? (
                <Textarea
                  id={`material-${field}`}
                  value={edit.input[field] ?? ""}
                  disabled={busy}
                  onChange={(e) =>
                    onChange({ ...edit.input, [field]: e.target.value })
                  }
                />
              ) : (
                <Input
                  id={`material-${field}`}
                  type={field === "publishDate" ? "date" : "text"}
                  value={edit.input[field] ?? ""}
                  disabled={
                    busy ||
                    (image.working &&
                      [
                        "channel",
                        "subChannel",
                        "titlePic",
                        "titlePic2",
                      ].includes(field))
                  }
                  onPaste={
                    field === "titlePic" || field === "titlePic2"
                      ? (event) => image.paste(event, field)
                      : undefined
                  }
                  onChange={(e) =>
                    onChange({ ...edit.input, [field]: e.target.value })
                  }
                />
              )}
              {(field === "titlePic" || field === "titlePic2") && (
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label={`上传 ${label}`}
                  disabled={busy || image.working}
                  className="block max-w-full text-xs file:mr-3 file:rounded-md file:border file:bg-secondary file:px-3 file:py-2"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    image.start(file, field);
                  }}
                />
              )}
            </div>
          ))}
          {(error || image.error) && (
            <p role="alert" className="text-sm text-destructive">
              {error || image.error}
            </p>
          )}
        </form>
        <DialogFooter className="shrink-0">
          <Button
            variant="outline"
            disabled={busy || image.working}
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            type="submit"
            form="material-form"
            disabled={busy || image.working}
          >
            {busy ? "正在保存…" : "保存素材"}
          </Button>
        </DialogFooter>
        {image.dialog}
      </DialogContent>
    </Dialog>
  );
}
