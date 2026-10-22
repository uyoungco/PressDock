import { useState, type PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";
import { Newspaper } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { navigation } from "@/components/layout/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { StatusBar } from "@/components/layout/StatusBar";

export function MobileLayout({ children }: PropsWithChildren) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-dvh flex-col">
      <TopBar onMenu={() => setOpen(true)} />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 p-5">
          <SheetTitle className="flex items-center gap-2">
            <Newspaper className="size-5" />
            PressDock
          </SheetTitle>
          <SheetDescription>新闻编辑工作空间</SheetDescription>
          <nav aria-label="主导航" className="mt-5 space-y-1">
            {navigation.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex min-h-12 items-center gap-3 rounded-md px-3 text-sm ${isActive ? "bg-muted font-medium" : "text-muted-foreground"}`
                }
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
      <main id="main-content" className="flex-1 overflow-auto bg-muted/20 p-4">
        {children}
      </main>
      <StatusBar />
    </div>
  );
}
