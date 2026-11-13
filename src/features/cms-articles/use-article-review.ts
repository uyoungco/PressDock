import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQueryClient } from "@tanstack/react-query";
import { businessKeys, invalidateBusinessQueries } from "@/lib/query-runtime";
import {
  reportAuthenticationExpired,
  onClientInvalidated,
  ServiceError,
} from "@/services/tauri/client";
import { authService } from "@/features/auth/service";
import type {
  ArticleView,
  CmsArticleDetail,
  CmsArticleRow,
  ReviewDecision,
  ArticleReviewSummary,
} from "@/types/cms-article";
import { reviewViewSchema } from "@/types/cms-article";
import { articleService } from "./service";
import { articleMemory } from "./state";

export function useArticleReview(view: ArticleView) {
  const auth = useAuth();
  const client = useQueryClient();
  const user = auth.session?.user.userId ?? 0;
  const allowed =
    view !== "quality" &&
    auth.status === "authenticated" &&
    Array.isArray(auth.session?.user.roles) &&
    !auth.session.user.roles.includes("editor");
  const [target, setTarget] = useState<{
    rows: CmsArticleRow[];
    detail: CmsArticleDetail | null;
    single: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [summary, setSummary] = useState(() =>
    articleMemory.reviewResult(view),
  );
  const [resultOpen, setResultOpen] = useState(
    () => !!articleMemory.reviewResult(view),
  );
  const [blockedDraft, setBlockedDraft] =
    useState<ReturnType<typeof articleMemory.dirtyFor>>(undefined);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const gate = useRef(false),
    alive = useRef(true),
    epoch = useRef(0);
  useEffect(() => {
    alive.current = true;
    const advanceEpoch = () => {
      epoch.current++;
    };
    const unsubscribe = onClientInvalidated(() => {
      advanceEpoch();
      setTarget(null);
      setDecision(null);
      setSelected(new Set());
      setBlockedDraft(undefined);
      setResultOpen(false);
      setSummary(null);
    });
    return () => {
      alive.current = false;
      advanceEpoch();
      unsubscribe();
    };
  }, []);
  const clearSelection = useCallback(() => setSelected(new Set()), []);
  async function begin(rows: CmsArticleRow[], single: boolean) {
    if (!allowed || gate.current || !rows.length) return;
    if (
      articleMemory.reviewNeedsRefresh(
        view,
        rows.map((row) => row.id),
      )
    ) {
      setSummary(articleMemory.reviewResult(view));
      setResultOpen(true);
      return;
    }
    const draft = articleMemory.dirtyFor(rows.map((row) => row.id));
    if (draft) {
      setBlockedDraft(draft);
      return;
    }
    gate.current = true;
    const started = epoch.current;
    setError(null);
    setDecision(null);
    setResultOpen(false);
    setTarget({ rows: structuredClone(rows), detail: null, single });
    setLoading(single);
    try {
      if (single) {
        const detail = await articleService.get(rows[0].id);
        if (alive.current && started === epoch.current)
          setTarget({ rows: structuredClone(rows), detail, single });
      }
    } catch (error) {
      if (alive.current && started === epoch.current)
        setError(error instanceof Error ? error.message : "无法读取审核详情");
    } finally {
      gate.current = false;
      if (alive.current) setLoading(false);
    }
  }
  async function submit() {
    if (
      !target ||
      !decision ||
      gate.current ||
      !allowed ||
      (target.single && !target.detail)
    )
      return;
    const draft = articleMemory.dirtyFor(target.rows.map((row) => row.id));
    if (draft) {
      setTarget(null);
      setDecision(null);
      setBlockedDraft(draft);
      return;
    }
    gate.current = true;
    setBusy(true);
    setError(null);
    const started = epoch.current;
    async function completed(value: ArticleReviewSummary) {
      if (
        started !== epoch.current ||
        authService.getSnapshot().session?.user.userId !== user
      )
        return;
      articleMemory.saveReviewResult(view, value);
      if (alive.current) {
        setSummary(value);
        setResultOpen(true);
        setTarget(null);
        setDecision(null);
        clearSelection();
      }
      if (value.authExpired) reportAuthenticationExpired();
      else await invalidateBusinessQueries(client, businessKeys.articles(user));
    }
    try {
      const common = {
        view: reviewViewSchema.parse(view),
        decision,
        comment: "",
      };
      const value = target.detail
        ? await articleService.review({ ...common, article: target.detail })
        : await articleService.reviewBatch({
            ...common,
            articles: target.rows,
          });
      // 显式退出或换号后，旧批次不能恢复到新会话；AUTH_EXPIRED 摘要先保存再通知。
      await completed(value);
    } catch (error) {
      if (!(error instanceof ServiceError) || error.code === "IPC_ERROR") {
        await completed({
          authExpired: false,
          items: target.rows.map((row) => ({
            id: row.id,
            title: row.title,
            status: "unconfirmed",
            code: "IPC_RESULT_UNCONFIRMED",
            message: "未收到完整审核结果，请刷新核对；请勿直接重复提交",
          })),
        });
        return;
      }
      if (alive.current && started === epoch.current)
        setError(
          error instanceof Error ? error.message : "审核结果未确认，请刷新核对",
        );
    } finally {
      gate.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return {
    allowed,
    target,
    busy,
    loading,
    error,
    decision,
    summary,
    resultOpen,
    blockedDraft,
    selected,
    begin,
    submit,
    setDecision: (value: ReviewDecision | null) => {
      if (!gate.current) {
        setDecision(value);
        setError(null);
      }
    },
    setBlockedDraft,
    clearSelection,
    toggle: (id: number) =>
      setSelected((previous) => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    selectAll: (rows: CmsArticleRow[]) =>
      setSelected(new Set(rows.map((row) => row.id))),
    close: () => {
      if (!gate.current) {
        setTarget(null);
        setDecision(null);
        setError(null);
      }
    },
    closeResults: () => setResultOpen(false),
  };
}
export type ArticleReviewController = ReturnType<typeof useArticleReview>;
