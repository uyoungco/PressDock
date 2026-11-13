import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useBusinessQuery, useQueryUser } from "@/hooks/use-business-query";
import { articleService } from "@/features/cms-articles/service";
import { importService } from "@/features/import/service";
import { localCollectionDate } from "@/features/import/contracts";
import {
  businessKeys,
  harvestDateAtom,
  harvestNotificationErrorAtom,
  harvestNotificationsReadyAtom,
} from "@/lib/query-runtime";
import { isDemo } from "@/lib/platform";
import type { ReviewView } from "@/types/cms-article";
import { reviewOverviewQuery, summarizeHarvest } from "./model";

function useReviewOverview(view: ReviewView, enabled: boolean) {
  const user = useQueryUser();
  const query = reviewOverviewQuery(view);
  const result = useBusinessQuery(
    businessKeys.articlePage(user, query),
    () => articleService.list(query),
    enabled,
  );
  return { view, ...result };
}

export function useDashboard() {
  const user = useQueryUser();
  const enabled = user > 0 && !isDemo();
  const [date, setDate] = useState(localCollectionDate);
  const rememberDate = useSetAtom(harvestDateAtom);
  const ready = useAtomValue(harvestNotificationsReadyAtom);
  const notificationError = useAtomValue(harvestNotificationErrorAtom);
  useEffect(() => {
    const update = () => setDate(localCollectionDate());
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  const harvest = useBusinessQuery(
    businessKeys.harvestDate(user, date),
    () => importService.list(date),
    enabled && ready,
  );
  const first = useReviewOverview("review-1", enabled);
  const second = useReviewOverview("review-2", enabled);
  const third = useReviewOverview("review-3", enabled);
  const reviews = [first, second, third];
  const reviewTotal = reviews.every((review) => review.data !== undefined)
    ? reviews.reduce((sum, review) => sum + review.data!.total, 0)
    : null;
  return {
    date,
    harvest,
    stats: harvest.data ? summarizeHarvest(harvest.data.jobs) : null,
    reviews,
    reviewTotal,
    notificationError,
    refreshing:
      harvest.isFetching || reviews.some((review) => review.isFetching),
    refresh() {
      if (!enabled) return;
      if (ready) void harvest.refetch();
      reviews.forEach((review) => void review.refetch());
    },
    openToday() {
      const today = localCollectionDate();
      rememberDate({ date: today, today });
    },
  };
}
