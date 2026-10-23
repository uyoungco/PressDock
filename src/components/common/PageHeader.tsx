import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

export function PageHeader({
  title,
  description,
  action,
  demo = true,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  demo?: boolean;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="mb-1 flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {demo && (
            <Badge variant="outline" className="text-muted-foreground">
              演示工作区
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
