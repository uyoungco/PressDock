import { useEffect, useRef, useState } from "react";
import { useBeforeUnload, useBlocker } from "react-router-dom";
import { useSetAtom } from "jotai";
import { toast } from "sonner";
import { editorDirtyAtom } from "@/atoms/editor";
import { authService } from "@/features/auth/service";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { MaterialForm } from "@/features/channels/MaterialForm";
import { blankInput } from "@/features/channels/edit-buffer";
import { channelService } from "@/features/channels/service";
import type { ChannelGroup } from "@/types/cms";
import {
  articlePromoteSchema,
  articleUpdateSchema,
  type ArticleClass,
  type ArticleView,
  type CmsArticleRow,
} from "@/types/cms-article";
import { articleInput, articleService } from "./service";
import { articleEditIsDirty, articleMemory, type ArticleEdit } from "./state";
import { EditorSheet } from "./EditorSheet";

const message = (error: unknown) =>
  error instanceof Error ? error.message : "请求失败，请重试";
export function useArticleActions(
  view: ArticleView,
  classes: ArticleClass[],
  classesError: string | null,
  retryClasses: () => void,
  refresh: () => void,
) {
  const [edit, setEdit] = useState(() => articleMemory.edit(view));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [groups, setGroups] = useState<ChannelGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [groupsRetry, setGroupsRetry] = useState(0);
  const alive = useRef(true),
    gate = useRef(false);
  const setDirty = useSetAtom(editorDirtyAtom);
  const dirty = articleEditIsDirty(edit) || busy || uploading;
  const promoting = edit?.kind === "promote";
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
  useEffect(() => {
    if (!promoting) return;
    let active = true;
    setGroupsLoading(true);
    setGroupsError(null);
    channelService
      .groups()
      .then((value) => {
        if (active) setGroups(value);
      })
      .catch((reason: unknown) => {
        if (active) setGroupsError(message(reason));
      })
      .finally(() => {
        if (active) setGroupsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [promoting, groupsRetry]);
  const blocker = useBlocker(
    () => dirty && authService.getSnapshot().status === "authenticated",
  );
  useBeforeUnload((event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  function change(value: ArticleEdit) {
    setEdit(value);
    setError(null);
    if (articleEditIsDirty(value)) articleMemory.saveEdit(view, value);
    else articleMemory.removeEdit(view);
  }
  function close() {
    setEdit(null);
    setError(null);
    setDiscard(false);
    articleMemory.removeEdit(view);
  }
  function requestClose() {
    if (busy || uploading) return;
    if (articleEditIsDirty(edit)) setDiscard(true);
    else close();
  }
  async function beginEdit(row: CmsArticleRow) {
    if (gate.current || edit) return;
    gate.current = true;
    setBusy(true);
    try {
      const base = await articleService.get(row.id);
      if (alive.current) {
        setEdit({ kind: "edit", base, input: articleInput(base) });
        setError(null);
      }
    } catch (error) {
      if (alive.current) toast.error(message(error));
    } finally {
      gate.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function beginPromote(article: CmsArticleRow) {
    if (gate.current || edit) return;
    const today = new Date();
    const publishDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    change({
      kind: "promote",
      article,
      input: {
        ...blankInput(),
        title: article.title ?? "",
        titlePic: article.titlePic ?? "",
        titlePic2: article.titlePic2 ?? "",
        smallText: article.smallText ?? "",
        writer: article.writer ?? "",
        publishDate,
      },
    });
  }
  async function save() {
    if (!edit || gate.current || uploading) return;
    const parsed =
      edit.kind === "edit"
        ? articleUpdateSchema.safeParse(edit.input)
        : articlePromoteSchema.safeParse({
            article: edit.article,
            input: edit.input,
          });
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join("；"));
      return;
    }
    if (edit.kind === "promote") {
      const group = groups.find(
        (group) => group.channel === edit.input.channel,
      );
      if (
        groupsLoading ||
        groupsError ||
        !group ||
        (group.subchannels.length > 0 &&
          !group.subchannels.includes(edit.input.subChannel ?? ""))
      ) {
        setError("请选择有效渠道和子渠道，配置加载失败时请先重试。");
        return;
      }
    }
    gate.current = true;
    setBusy(true);
    setError(null);
    try {
      // 两种写入保留各自协议，不复用普通素材新增的 Id=0。
      if (edit.kind === "edit")
        await articleService.update(articleUpdateSchema.parse(edit.input));
      else
        await articleService.promote({
          article: edit.article,
          input: edit.input,
        });
      if (alive.current) {
        close();
        toast.success(
          edit.kind === "edit" ? "文章修改已保存" : "已添加到渠道素材",
        );
        refresh();
      }
    } catch (reason) {
      if (alive.current) setError(message(reason));
    } finally {
      gate.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return {
    busy,
    beginEdit,
    beginPromote,
    dialogs: (
      <>
        {edit?.kind === "edit" && (
          <EditorSheet
            input={edit.input}
            classes={classes}
            classesError={classesError}
            retryClasses={retryClasses}
            onChange={(input) => change({ ...edit, input })}
            onClose={requestClose}
            onSave={() => void save()}
            busy={busy}
            uploading={uploading}
            onUploading={setUploading}
            error={error}
            onError={setError}
          />
        )}
        {edit?.kind === "promote" && (
          <MaterialForm
            title={`添加到渠道素材 · 文章 ${edit.article.id}`}
            edit={{ base: null, input: edit.input }}
            onChange={(input) => change({ ...edit, input })}
            onClose={requestClose}
            onSave={() => void save()}
            busy={busy}
            onUploading={setUploading}
            error={error}
            channels={{
              groups,
              loading: groupsLoading,
              error: groupsError,
              retry: () => setGroupsRetry((value) => value + 1),
            }}
          />
        )}
        <Dialog
          open={discard || blocker.state === "blocked"}
          onOpenChange={(open) => {
            if (!open) {
              setDiscard(false);
              if (blocker.state === "blocked") blocker.reset();
            }
          }}
        >
          <DialogContent>
            <DialogTitle>放弃未保存修改？</DialogTitle>
            <DialogDescription>
              {busy || uploading
                ? "请求正在进行，请等待完成后再离开。"
                : "未保存的表单将被丢弃，已上传文件不会自动删除。"}
            </DialogDescription>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setDiscard(false);
                  if (blocker.state === "blocked") blocker.reset();
                }}
              >
                继续编辑
              </Button>
              <Button
                variant="destructive"
                disabled={busy || uploading}
                onClick={() => {
                  close();
                  if (blocker.state === "blocked") blocker.proceed();
                }}
              >
                放弃修改{blocker.state === "blocked" ? "并离开" : ""}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    ),
  };
}
