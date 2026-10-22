import { Skeleton } from "@/components/ui/skeleton";
export function LoadState({
  loading,
  error,
}: {
  loading: boolean;
  error: string | null;
}) {
  if (error)
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/30 p-5 text-sm text-destructive"
      >
        {error}。请检查本地服务后重新打开页面。
      </div>
    );
  if (loading)
    return (
      <div aria-label="正在加载" className="space-y-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  return null;
}
