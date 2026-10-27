import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { navigation } from "./navigation";

// 桌面和移动导航共用同一分组交互；收起状态点击父菜单会展开侧栏。
export function NavigationItems({
  expanded = true,
  onExpand,
  onNavigate,
}: {
  expanded?: boolean;
  onExpand?: () => void;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const [groupOpen, setGroupOpen] = useState(pathname.startsWith("/articles"));
  return navigation.map(({ to, label, icon: Icon, children }) => {
    const active = pathname.startsWith(to);
    const classes = cn(
      "flex min-h-10 w-full items-center justify-start gap-3 rounded-md px-3 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground max-md:min-h-12",
      active && "bg-sidebar-accent font-medium text-foreground",
    );
    return (
      <div key={to}>
        {to === "/settings" && <Separator className="my-3" />}
        <Tooltip>
          <TooltipTrigger asChild>
            {children ? (
              <Button
                variant="ghost"
                aria-label={label}
                aria-expanded={expanded && groupOpen}
                className={classes}
                onClick={() => {
                  if (!expanded) {
                    onExpand?.();
                    setGroupOpen(true);
                  } else setGroupOpen(!groupOpen);
                }}
              >
                <Icon className="size-4 shrink-0" />
                {expanded && (
                  <>
                    <span>{label}</span>
                    <ChevronDown
                      className={cn(
                        "ml-auto size-4 transition-transform",
                        groupOpen && "rotate-180",
                      )}
                    />
                  </>
                )}
              </Button>
            ) : (
              <NavLink
                to={to}
                aria-label={label}
                className={classes}
                onClick={onNavigate}
              >
                <Icon className="size-4 shrink-0" />
                {expanded && label}
              </NavLink>
            )}
          </TooltipTrigger>
          {!expanded && <TooltipContent side="right">{label}</TooltipContent>}
        </Tooltip>
        {children && expanded && groupOpen && (
          <div className="ml-5 mt-1 space-y-1 border-l pl-2">
            {children.map((child) => (
              <NavLink
                key={child.to}
                to={child.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-10 items-center rounded-md px-2 text-sm text-muted-foreground hover:bg-sidebar-accent max-md:min-h-12",
                    isActive && "bg-sidebar-accent font-medium text-foreground",
                  )
                }
              >
                {child.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    );
  });
}
