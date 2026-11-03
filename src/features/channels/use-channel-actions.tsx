import { isAndroid, isDemo } from "@/lib/platform";
import { channelDraftService } from "./draft-service";
import { useEffect, useRef, useState } from "react";
import { useBeforeUnload, useBlocker } from "react-router-dom";
import { useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { businessKeys, invalidateBusinessQueries } from "@/lib/query-runtime";
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
  type ChannelGroup,
} from "@/types/cms";

const message = (e: unknown) =>
  e instanceof Error ? e.message : "请求失败，请重试";
export function useChannelActions(
  query: PromoteQuery,
  refresh: (deleted: boolean) => void,
  channels?: {
    groups: ChannelGroup[];
    loading: boolean;
    error: string | null;
    retry: () => void;
  },
) {
  const user = useAuth().session?.user.userId ?? 0;
  const client = useQueryClient();
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [retained, setRetained] = useState<MaterialEdit | null>(null);
  const [recovery, setRecovery] = useState<MaterialEdit | null>(null);
  const [draftReady, setDraftReady] = useState(!isAndroid());
  const [draftLoadError, setDraftLoadError] = useState<string | null>(null);
  const [draftAttempt, setDraftAttempt] = useState(0);
  const [edit, setEdit] = useState<MaterialEdit | null>(() =>
    isAndroid() ? null : channelEditBuffers.get(user),
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
    if (!isAndroid() || !user) return;
    let active = true;
    setDraftLoadError(null);
    void channelDraftService
      .load()
      .then((value) => {
        if (active) {
          setRecovery(value);
          setDraftReady(true);
        }
      })
      .catch((e) => {
        if (active)
          setDraftLoadError(e instanceof Error ? e.message : "草稿读取失败");
      });
    return () => {
      active = false;
    };
  }, [user, draftAttempt]);
  useEffect(() => {
    if (!isAndroid() || !draftReady || !edit) return;
    if (!editIsDirty(edit)) {
      void channelDraftService.clear(user).catch((e) => toast.error(String(e)));
      return;
    }
    let active = true;
    const persist = () => {
      void channelDraftService
        .save(user, edit)
        .then(() => {
          if (active) setDraftStatus("已保存到本机，尚未提交 CMS");
        })
        .catch((e) => {
          if (active)
            setDraftStatus(e instanceof Error ? e.message : "本机草稿保存失败");
        });
    };
    const timer = window.setTimeout(persist, 500);
    const background = () => {
      if (document.visibilityState === "hidden") persist();
    };
    document.addEventListener("visibilitychange", background);
    return () => {
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", background);
    };
  }, [edit, draftReady, user]);
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
    if (isAndroid()) setDraftStatus("正在保存到本机…");
    if (editIsDirty(value)) channelEditBuffers.set(user, value);
    else channelEditBuffers.remove(user);
  }
  function close() {
    setEdit(null);
    setRetained(null);
    setDraftStatus(null);
    setUploading(false);
    setEditError(null);
    setDiscard(false);
    channelEditBuffers.remove(user);
    if (isAndroid())
      void channelDraftService
        .clear(user)
        .catch((e) =>
          toast.error(e instanceof Error ? e.message : "草稿清理失败"),
        );
  }
  function requestClose() {
    if (busy) return;
    if (editIsDirty(edit) || uploading) setDiscard(true);
    else close();
  }
  async function retain(leave = false) {
    if (!edit || busy || uploading) return;
    setBusy(true);
    try {
      await channelDraftService.save(user, edit);
      if (!alive.current) return;
      setRetained(edit);
      setEdit(null);
      setDiscard(false);
      channelEditBuffers.set(user, edit);
      if (leave && blocker.state === "blocked") blocker.proceed();
    } catch (e) {
      toast.error(message(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function beginEdit(row: PromoteRecord) {
    if (retained) {
      setRecovery(retained);
      return;
    }
    if (gate.current || !draftReady || recovery) return;
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
      refresh(false);
      void invalidateBusinessQueries(client, businessKeys.channels(user));
      if (alive.current) {
        close();
        toast.success(isDemo() ? "演示素材已保存到本机" : "素材已保存");
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
      refresh(true);
      void invalidateBusinessQueries(client, businessKeys.channels(user));
      if (alive.current) {
        setDeleteTarget(null);
        toast.success(isDemo() ? "演示素材已从本机删除" : "素材已删除");
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
      refresh(false);
      void invalidateBusinessQueries(client, businessKeys.channels(user));
      if (alive.current) {
        setSorted(null);
        setSortChanged(false);
        toast.success(isDemo() ? "演示排序已保存到本机" : "排序已保存");
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
    busy: busy || !draftReady || !!recovery,
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
      if (retained) {
        setRecovery(retained);
        return;
      }
      if (!draftReady || recovery) return;
      setEdit({ base: null, input: blankInput() });
      setEditError(null);
    },
    beginEdit,
    hasRetainedDraft: !!retained,
    resumeDraft: () => {
      if (retained) setRecovery(retained);
    },
    requestDelete: (row: PromoteRecord) => {
      setDeleteTarget(row);
      setDeleteError(null);
    },
    dialogs: (
      <>
        <Dialog open={!!draftLoadError}>
          <DialogContent
            showCloseButton={false}
            onInteractOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.preventDefault()}
          >
            <DialogTitle>本机草稿读取失败</DialogTitle>
            <DialogDescription>
              {draftLoadError}
              。为避免覆盖草稿，请重试，或清除本机素材草稿后继续。
            </DialogDescription>
            <DialogFooter>
              <Button
                variant="destructive"
                onClick={() => {
                  void channelDraftService
                    .clear(user)
                    .then(() => {
                      setDraftLoadError(null);
                      setDraftReady(true);
                    })
                    .catch((e) => setDraftLoadError(message(e)));
                }}
              >
                清除草稿并继续
              </Button>
              <Button onClick={() => setDraftAttempt((n) => n + 1)}>
                重试读取
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={!!recovery}>
          <DialogContent
            showCloseButton={false}
            onInteractOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.preventDefault()}
          >
            <DialogTitle>恢复本机素材草稿？</DialogTitle>
            <DialogDescription>
              上次修改尚未提交 CMS，可继续编辑或丢弃。
            </DialogDescription>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  void channelDraftService
                    .clear(user)
                    .then(() => {
                      setRecovery(null);
                      setRetained(null);
                      channelEditBuffers.remove(user);
                    })
                    .catch((e) => toast.error(message(e)));
                }}
              >
                丢弃草稿
              </Button>
              <Button
                onClick={() => {
                  setEdit(recovery);
                  setRetained(null);
                  setRecovery(null);
                  setDraftStatus("已恢复本机草稿，尚未提交 CMS");
                }}
              >
                继续编辑
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
            draftStatus={draftStatus}
            channels={isAndroid() ? channels : undefined}
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
              {isAndroid() && (
                <Button
                  variant="outline"
                  disabled={busy || uploading}
                  onClick={() => void retain()}
                >
                  保留草稿并返回
                </Button>
              )}
              <Button
                variant="destructive"
                disabled={busy || uploading}
                onClick={close}
              >
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
                disabled={isAndroid() && (busy || uploading)}
                onClick={() => {
                  discardAll();
                  if (blocker.state === "blocked") blocker.proceed();
                }}
              >
                放弃并离开
              </Button>
              {isAndroid() && edit && (
                <Button
                  disabled={busy || uploading || sortChanged}
                  onClick={() => void retain(true)}
                >
                  保留草稿并离开
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    ),
  };
}
