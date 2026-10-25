import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ZodError } from "zod";
import { aiService } from "./service";
import { emptySettings } from "./contracts";

export function aiErrorMessage(error: unknown) {
  if (error instanceof ZodError)
    return error.issues.map((issue) => issue.message).join("；");
  return error instanceof Error ? error.message : "AI 操作失败，请重试";
}
export function useAiSettings(active: boolean) {
  const [settings, setSettings] = useState(emptySettings);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    const next = await aiService.load();
    if (mounted.current) setSettings(next);
    return next;
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    let valid = true;
    setLoading(true);
    setError(null);
    aiService
      .load()
      .then((next) => {
        if (valid) setSettings(next);
      })
      .catch((reason) => {
        if (valid) setError(aiErrorMessage(reason));
      })
      .finally(() => {
        if (valid) setLoading(false);
      });
    return () => {
      valid = false;
    };
  }, [active]);
  async function run(
    work: (signal: AbortSignal) => Promise<void>,
    success?: string,
  ) {
    if (lock.current) return;
    lock.current = true;
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError(null);
    try {
      await work(current.signal);
      if (!mounted.current) return;
      await refresh();
      if (mounted.current && success) toast.success(success);
    } catch (reason) {
      if (mounted.current) setError(aiErrorMessage(reason));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
      controller.current = null;
    }
  }
  return { settings, loading, busy, error, refresh, run };
}
