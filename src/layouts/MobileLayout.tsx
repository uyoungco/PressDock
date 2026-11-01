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
import { ScrollArea } from "@/components/ui/scroll-area";
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
          <ScrollArea className="mt-5 flex-1">
            <nav aria-label="主导航" className="flex flex-col gap-1">
              <NavigationItems onNavigate={() => setOpen(false)} />
            </nav>
          </ScrollArea>
        </SheetContent>
      </Sheet>
      <main
        id="main-content"
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-muted/20",
          contentScroll === "contained" && "p-2",
        )}
      >
        {contentScroll === "contained" ? (
          children
        ) : (
          <ScrollArea className="flex-1">
            <div className="p-4">{children}</div>
          </ScrollArea>
        )}
      </main>
      <StatusBar />
    </div>
  );
}
