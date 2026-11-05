import { useEffect, useRef, useState } from "react";
import { useBeforeUnload, useBlocker } from "react-router-dom";
import { useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { useBusinessQuery, useQueryUser } from "@/hooks/use-business-query";
import { businessKeys, invalidateBusinessQueries } from "@/lib/query-runtime";
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
import { isAndroid } from "@/lib/platform";

const message = (error: unknown) =>
  error instanceof Error ? error.message : "请求失败，请重试";
export function useArticleActions(
  view: ArticleView,
  classes: ArticleClass[],
  classesError: string | null,
  retryClasses: () => void,
) {
  const user = useQueryUser();
  const client = useQueryClient();
  // 手机返回列表时仅显示恢复入口；桌面保留直接恢复编辑的原有行为。
  const [edit, setEdit] = useState(() =>
    isAndroid() ? null : articleMemory.edit(view),
  );
  const [savedDraft, setSavedDraft] = useState(() => articleMemory.edit(view));
  const [pendingOpen, setPendingOpen] = useState<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [discard, setDiscard] = useState(false);
  const alive = useRef(true),
    gate = useRef(false);
  const setDirty = useSetAtom(editorDirtyAtom);
  const dirty = articleEditIsDirty(edit) || busy || uploading;
  const promoting = edit?.kind === "promote";
  const groupQuery = useBusinessQuery(
    businessKeys.groups(user),
    channelService.groups,
    promoting,
  );
  const groups: ChannelGroup[] = groupQuery.data ?? [];
  const groupsLoading = groupQuery.isPending;
  const groupsError = groupQuery.error?.message ?? null;
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
  useBeforeUnload((event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  function change(value: ArticleEdit) {
    setEdit(value);
    setError(null);
    if (articleEditIsDirty(value)) {
      articleMemory.saveEdit(view, value);
      setSavedDraft(value);
    } else {
      articleMemory.removeEdit(view);
      setSavedDraft(null);
    }
  }
  function close() {
    setEdit(null);
    setError(null);
    setDiscard(false);
    articleMemory.removeEdit(view);
    setSavedDraft(null);
  }
  function requestClose() {
    if (busy || uploading) return;
    if (articleEditIsDirty(edit)) setDiscard(true);
    else close();
  }
  async function beginEdit(row: CmsArticleRow) {
    if (gate.current || edit) return;
    if (isAndroid() && savedDraft) {
      setPendingOpen(() => () => void loadEdit(row));
      return;
    }
    await loadEdit(row);
  }
  async function loadEdit(row: CmsArticleRow) {
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
    if (isAndroid() && savedDraft) {
      setPendingOpen(() => () => openPromote(article));
      return;
    }
    openPromote(article);
  }
  function openPromote(article: CmsArticleRow) {
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
      void invalidateBusinessQueries(
        client,
        edit.kind === "edit"
          ? businessKeys.articles(user)
          : businessKeys.channels(user),
      );
      // 转素材后文章卡片中的渠道推荐信息也需要重新读取。
      if (isAndroid() && edit.kind === "promote")
        void invalidateBusinessQueries(client, businessKeys.articles(user));
      if (alive.current) {
        close();
        toast.success(
          edit.kind === "edit" ? "文章修改已保存" : "已添加到渠道素材",
        );
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
    savedDraft,
    restoreDraft: () => setEdit(articleMemory.edit(view)),
    discardDraft: close,
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
              retry: () => {
                void groupQuery.refetch();
              },
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
          <DialogContent
            data-article-dialog={isAndroid() ? "leave" : undefined}
          >
            <DialogTitle>
              {isAndroid() ? "离开文章编辑？" : "放弃未保存修改？"}
            </DialogTitle>
            <DialogDescription>
              {busy || uploading
                ? "请求正在进行，请等待完成后再离开。"
                : isAndroid()
                  ? "可保留到本次运行的内存草稿；退出、换号或重启会清除。已上传文件不会自动删除。"
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
              {isAndroid() && (
                <Button
                  variant="outline"
                  disabled={busy || uploading}
                  onClick={() => {
                    // 先保存最新输入，再解除浮层；保留的草稿必须由用户显式恢复。
                    if (edit) {
                      articleMemory.saveEdit(view, edit);
                      setSavedDraft(edit);
                    }
                    setEdit(null);
                    setError(null);
                    setDiscard(false);
                    if (blocker.state === "blocked") blocker.proceed();
                  }}
                >
                  保留草稿并{blocker.state === "blocked" ? "离开" : "返回"}
                </Button>
              )}
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
        {isAndroid() && (
          <Dialog
            open={!!pendingOpen}
            onOpenChange={(open) => {
              if (!open) setPendingOpen(null);
            }}
          >
            <DialogContent data-article-dialog="draft">
              <DialogTitle>此类别已有未保存草稿</DialogTitle>
              <DialogDescription>
                继续原草稿，或放弃后打开新文章；每个类别只保留一份运行内存草稿。
              </DialogDescription>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPendingOpen(null)}>
                  取消
                </Button>
                <Button
                  onClick={() => {
                    setPendingOpen(null);
                    setEdit(articleMemory.edit(view));
                  }}
                >
                  继续草稿
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    const open = pendingOpen;
                    close();
                    setPendingOpen(null);
                    open?.();
                  }}
                >
                  放弃并打开
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </>
    ),
  };
}
