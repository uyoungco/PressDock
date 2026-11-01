import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
export function LoadState({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string | null;
  retry?: () => void;
}) {
  if (error)
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/30 p-5 text-sm text-destructive"
      >
        {error}
        {retry && (
          <Button variant="outline" size="sm" className="ml-3" onClick={retry}>
            重试
          </Button>
        )}
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
