import { useState, type PropsWithChildren } from "react";
import { Newspaper } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { NavigationItems } from "@/components/layout/NavigationItems";
import { TopBar } from "@/components/layout/TopBar";
import { StatusBar } from "@/components/layout/StatusBar";
import { cn } from "@/lib/utils";

export function MobileLayout({
  children,
  contentScroll = "page",
}: PropsWithChildren<{ contentScroll?: "page" | "contained" }>) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-dvh min-w-0 flex-col overflow-hidden">
      <TopBar onMenu={() => setOpen(true)} />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 p-5">
          <SheetTitle className="flex items-center gap-2">
            <Newspaper className="size-5" />
            PressDock
          </SheetTitle>
          <SheetDescription>新闻编辑工作空间</SheetDescription>
          <nav
            aria-label="主导航"
            className="mt-5 min-h-0 flex-1 space-y-1 overflow-y-auto"
          >
            <NavigationItems onNavigate={() => setOpen(false)} />
          </nav>
        </SheetContent>
      </Sheet>
      <main
        id="main-content"
        className={cn(
          "min-h-0 min-w-0 flex-1 bg-muted/20",
          contentScroll === "contained"
            ? "flex flex-col overflow-hidden p-2"
            : "overflow-auto p-4",
        )}
      >
        {children}
      </main>
      <StatusBar />
    </div>
  );
}
