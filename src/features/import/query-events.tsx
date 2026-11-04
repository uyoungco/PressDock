import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  businessKeys,
  harvestNotificationErrorAtom,
  harvestNotificationsReadyAtom,
  invalidateBusinessQueries,
} from "@/lib/query-runtime";
import { importService } from "./service";

export function HarvestQueryEvents() {
  const auth = useAuth();
  const client = useQueryClient();
  const setError = useSetAtom(harvestNotificationErrorAtom);
  const setReady = useSetAtom(harvestNotificationsReadyAtom);
  const user = auth.session?.user.userId;
  useEffect(() => {
    setReady(false);
    if (user === undefined) return;
    let active = true;
    let stop: (() => void) | undefined;
    setError(null);
    const changed = () => {
      if (active)
        void invalidateBusinessQueries(
          client,
          businessKeys.harvest(user),
          businessKeys.articles(user),
        );
    };
    // 离开采集页仍接收变化；先订阅，再允许采集页读取快照，避免遗漏通知。
    importService
      .subscribe(changed)
      .then((unsubscribe) => {
        if (!active) {
          unsubscribe();
          return;
        }
        stop = unsubscribe;
        setReady(true);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            `实时状态通知不可用，请手动刷新：${reason instanceof Error ? reason.message : "订阅失败"}`,
          );
          setReady(true);
        }
      });
    return () => {
      active = false;
      stop?.();
    };
  }, [client, user, setError, setReady]);
  return null;
}
