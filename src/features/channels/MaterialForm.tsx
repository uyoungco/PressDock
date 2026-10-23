import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { channelService } from "./service";
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
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const alive = useRef(true);
  const locked = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const latest = useRef(edit.input);
  useEffect(() => {
    latest.current = edit.input;
  }, [edit.input]);
  async function upload(
    file: File | undefined,
    field: "titlePic" | "titlePic2",
  ) {
    if (!file || locked.current || busy) return;
    locked.current = true;
    setUploading(true);
    onUploading(true);
    setUploadError(null);
    try {
      const result = await channelService.upload(file);
      if (alive.current) onChange({ ...latest.current, [field]: result.url });
    } catch (reason) {
      if (alive.current)
        setUploadError(
          reason instanceof Error ? reason.message : "图片上传失败",
        );
    } finally {
      locked.current = false;
      if (alive.current) {
        setUploading(false);
        onUploading(false);
      }
    }
  }
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
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogTitle>{edit.base ? "修改素材" : "新增素材"}</DialogTitle>
        <DialogDescription>
          带 * 的字段必填。上传图片只回填地址，保存后才关联素材。
        </DialogDescription>
        <form
          id="material-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!uploading && !busy) onSave();
          }}
          noValidate
          className="space-y-4"
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
                    (uploading && ["titlePic", "titlePic2"].includes(field))
                  }
                  onChange={(e) =>
                    onChange({ ...edit.input, [field]: e.target.value })
                  }
                />
              )}
              {(field === "titlePic" || field === "titlePic2") && (
                <input
                  type="file"
                  accept="image/*"
                  aria-label={`上传 ${label}`}
                  disabled={busy || uploading}
                  className="block max-w-full text-xs file:mr-3 file:rounded-md file:border file:bg-secondary file:px-3 file:py-2"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    void upload(file, field);
                  }}
                />
              )}
            </div>
          ))}
          {uploading && <p role="status">正在上传图片…</p>}
          {(error || uploadError) && (
            <p role="alert" className="text-sm text-destructive">
              {error || uploadError}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            type="submit"
            form="material-form"
            disabled={busy || uploading}
          >
            {busy ? "正在保存…" : "保存素材"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
