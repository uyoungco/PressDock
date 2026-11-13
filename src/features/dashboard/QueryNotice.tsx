import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function QueryNotice({
  error,
  stale = false,
  retry,
  label,
}: {
  error: string;
  stale?: boolean;
  retry: () => void;
  label: string;
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>
        {label}
        {stale ? "刷新失败，保留上次数据" : "读取失败"}
      </AlertTitle>
      <AlertDescription className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">
          {error}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={retry}
          aria-label={`重试${label}`}
        >
          重试
        </Button>
      </AlertDescription>
    </Alert>
  );
}
