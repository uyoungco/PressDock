import type { PropsWithChildren } from "react";
import { useAtom } from "jotai";
import { NavLink, useLocation } from "react-router-dom";
import { Newspaper, HardDrive, ChevronRight } from "lucide-react";
import { sidebarOpenAtom } from "@/atoms/navigation";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { navigation } from "@/components/layout/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { StatusBar } from "@/components/layout/StatusBar";
import { cn } from "@/lib/utils";

export function DesktopLayout({
  children,
  contentScroll = "page",
}: PropsWithChildren<{ contentScroll?: "page" | "contained" }>) {
  const [open, setOpen] = useAtom(sidebarOpenAtom);
  const { pathname } = useLocation();
  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r bg-sidebar transition-[width] duration-150 motion-reduce:transition-none",
          open ? "w-58" : "w-16",
        )}
      >
        <div className="flex h-14 items-center gap-2.5 border-b px-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
            <Newspaper className="size-4" />
          </span>
          {open && (
            <span className="text-lg font-semibold tracking-tight">
              PressDock<span className="ml-1 text-emerald-600">.</span>
            </span>
          )}
        </div>
        {open && (
          <div className="px-5 pt-6 pb-2 text-[10px] font-medium tracking-[0.16em] text-muted-foreground">
            编辑工作空间
          </div>
        )}
        <nav aria-label="主导航" className="space-y-1 p-2 pt-3">
          {navigation.map(({ to, label, icon: Icon }) => {
            const active = pathname.startsWith(to.split("/demo")[0]);
            return (
              <div key={to}>
                {to === "/settings" && <Separator className="my-3" />}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <NavLink
                      to={to}
                      aria-label={label}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-10 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                        active &&
                          "bg-sidebar-accent font-medium text-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      {open && (
                        <>
                          <span>{label}</span>
                          {active && (
                            <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
                          )}
                        </>
                      )}
                    </NavLink>
                  </TooltipTrigger>
                  {!open && (
                    <TooltipContent side="right">{label}</TooltipContent>
                  )}
                </Tooltip>
              </div>
            );
          })}
        </nav>
        {open && (
          <div className="m-3 mt-auto rounded-lg border bg-background p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium">
              <HardDrive className="size-3.5" />
              本地优先
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              素材与草稿独立保存，专注每一次编辑。
            </p>
            <Button
              variant="link"
              size="sm"
              asChild
              className="h-7 px-0 text-xs"
            >
              <NavLink to="/settings">
                工作区设置
                <ChevronRight className="size-3" />
              </NavLink>
            </Button>
          </div>
        )}
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setOpen(!open)} />
        <main
          id="main-content"
          className={cn(
            "min-h-0 min-w-0 flex-1 bg-muted/20",
            contentScroll === "contained"
              ? "flex flex-col overflow-hidden p-4"
              : "overflow-auto p-7",
          )}
        >
          {children}
        </main>
        <StatusBar />
      </div>
    </div>
  );
}
