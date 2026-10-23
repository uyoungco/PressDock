import { useEffect, useRef, useState } from "react";
import { useBeforeUnload, useBlocker } from "react-router-dom";
import { useSetAtom } from "jotai";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { authService } from "@/features/auth/service";
import { editorDirtyAtom } from "@/atoms/editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  channelEditBuffers,
  blankInput,
  editIsDirty,
  recordInput,
  type MaterialEdit,
} from "./edit-buffer";
import { MaterialForm } from "./MaterialForm";
import { channelService } from "./service";
import {
  promoteInputSchema,
  type PromoteInput,
  type PromoteQuery,
  type PromoteRecord,
} from "@/types/cms";

const message = (e: unknown) =>
  e instanceof Error ? e.message : "请求失败，请重试";
export function useChannelActions(
  query: PromoteQuery,
  refresh: (deleted: boolean) => void,
) {
  const user = useAuth().session?.user.userId ?? 0;
  const [edit, setEdit] = useState<MaterialEdit | null>(() =>
    channelEditBuffers.get(user),
  );
  const [editError, setEditError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sorted, setSorted] = useState<PromoteRecord[] | null>(null);
  const [sortChanged, setSortChanged] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PromoteRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [discard, setDiscard] = useState(false);
  const alive = useRef(true);
  const gate = useRef(false);
  const setDirty = useSetAtom(editorDirtyAtom);
  const dirty = editIsDirty(edit) || sortChanged || uploading || busy;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      setDirty(false);
    };
  }, [setDirty]);
  useEffect(() => {
    setDirty(dirty);
  }, [dirty, setDirty]);
  const blocker = useBlocker(
    () => dirty && authService.getSnapshot().status === "authenticated",
  );
  useBeforeUnload((e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  function change(input: PromoteInput) {
    if (!edit) return;
    const value = { ...edit, input };
    setEdit(value);
    setEditError(null);
    if (editIsDirty(value)) channelEditBuffers.set(user, value);
    else channelEditBuffers.remove(user);
  }
  function close() {
    setEdit(null);
    setUploading(false);
    setEditError(null);
    setDiscard(false);
    channelEditBuffers.remove(user);
  }
  function requestClose() {
    if (busy) return;
    if (editIsDirty(edit) || uploading) setDiscard(true);
    else close();
  }
  async function beginEdit(row: PromoteRecord) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    try {
      const base = await channelService.get(row.id);
      if (alive.current) {
        setEdit({ base, input: recordInput(base) });
        setEditError(null);
      }
    } catch (e) {
      if (alive.current) toast.error(message(e));
    } finally {
      gate.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function save() {
    if (!edit || gate.current || uploading) return;
    const parsed = promoteInputSchema.safeParse(edit.input);
    if (!parsed.success) {
      setEditError(parsed.error.issues.map((i) => i.message).join("；"));
      return;
    }
    gate.current = true;
    setBusy(true);
    setEditError(null);
    try {
      if (edit.base)
        await channelService.update({ ...edit.base, ...parsed.data });
      else await channelService.create(parsed.data);
      if (alive.current) {
        close();
        toast.success("素材已保存");
        refresh(false);
      }
    } catch (e) {
      if (alive.current) setEditError(message(e));
    } finally {
      gate.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function remove() {
    if (!deleteTarget || gate.current) return;
    gate.current = true;
    setBusy(true);
    setDeleteError(null);
    try {
      await channelService.remove(deleteTarget.id);
      if (alive.current) {
        setDeleteTarget(null);
        toast.success("素材已删除");
        refresh(true);
      }
    } catch (e) {
      if (alive.current) setDeleteError(message(e));
    } finally {
      gate.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function move(from: number, to: number) {
    if (busy) return;
    setSorted((rows) => {
      if (!rows) return rows;
      const next = [...rows],
        a = next.findIndex((r) => r.id === from),
        b = next.findIndex((r) => r.id === to);
      if (a < 0 || b < 0 || a === b) return rows;
      next.splice(b, 0, next.splice(a, 1)[0]);
      return next;
    });
    if (from !== to) setSortChanged(true);
  }
  async function saveOrder() {
    if (!sorted || gate.current) return;
    gate.current = true;
    setBusy(true);
    try {
      await channelService.order(
        query,
        sorted.map((r) => r.id),
      );
      if (alive.current) {
        setSorted(null);
        setSortChanged(false);
        toast.success("排序已保存");
        refresh(false);
      }
    } catch (e) {
      if (alive.current) toast.error(message(e));
    } finally {
      gate.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function discardAll() {
    close();
    setSorted(null);
    setSortChanged(false);
  }
  return {
    busy,
    sorting: !!sorted,
    sorted,
    move,
    startSort: (rows: PromoteRecord[]) => {
      setSorted([...rows]);
      setSortChanged(false);
    },
    cancelSort: () => {
      setSorted(null);
      setSortChanged(false);
    },
    saveOrder,
    create: () => {
      setEdit({ base: null, input: blankInput() });
      setEditError(null);
    },
    beginEdit,
    requestDelete: (row: PromoteRecord) => {
      setDeleteTarget(row);
      setDeleteError(null);
    },
    dialogs: (
      <>
        {edit && (
          <MaterialForm
            key={edit.base?.id ?? "new"}
            edit={edit}
            onChange={change}
            onClose={requestClose}
            onSave={() => void save()}
            busy={busy}
            onUploading={setUploading}
            error={editError}
          />
        )}
        <Dialog
          open={!!deleteTarget}
          onOpenChange={(open) => {
            if (!open && !busy) setDeleteTarget(null);
          }}
        >
          <DialogContent>
            <DialogTitle>删除素材？</DialogTitle>
            <DialogDescription>
              将删除素材 {deleteTarget?.id}：{deleteTarget?.title ?? "无标题"}
              。此操作会提交到新闻后台。
            </DialogDescription>
            {deleteError && (
              <p role="alert" className="text-destructive">
                {deleteError}
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setDeleteTarget(null)}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => void remove()}
              >
                {busy ? "正在删除…" : "确认删除"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={discard} onOpenChange={setDiscard}>
          <DialogContent>
            <DialogTitle>放弃未保存的素材修改？</DialogTitle>
            <DialogDescription>
              未保存的表单内容将被丢弃；已上传文件不会自动删除。
            </DialogDescription>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDiscard(false)}>
                继续编辑
              </Button>
              <Button variant="destructive" onClick={close}>
                放弃修改
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={blocker.state === "blocked"}
          onOpenChange={(open) => {
            if (!open && blocker.state === "blocked") blocker.reset();
          }}
        >
          <DialogContent>
            <DialogTitle>离开并放弃未保存内容？</DialogTitle>
            <DialogDescription>
              {busy
                ? "请求正在进行，离开不会撤销已发送的请求，请稍后刷新核对。"
                : "当前素材修改或排序尚未保存。"}
            </DialogDescription>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => blocker.state === "blocked" && blocker.reset()}
              >
                留在此页
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  discardAll();
                  if (blocker.state === "blocked") blocker.proceed();
                }}
              >
                放弃并离开
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    ),
  };
}
