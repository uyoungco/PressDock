import { isAndroid } from "@/lib/platform";
import { useAtom } from "jotai";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Search,
  Settings,
  PanelLeft,
  UserRound,
  ArrowLeft,
  ChevronDown,
} from "lucide-react";
import { globalSearchAtom } from "@/atoms/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { navigation } from "./navigation";
import { AccountControls } from "./AccountControls";
import { settingsModules } from "@/features/settings/modules";
import { cn } from "@/lib/utils";

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const [search, setSearch] = useAtom(globalSearchAtom);
  const navigate = useNavigate();
  const { pathname, search: query } = useLocation();
  const android = isAndroid();
  const current = navigation
    .flatMap((item) => item.children ?? [item])
    .find((item) => pathname.startsWith(item.to));
  const settingsTab =
    pathname === "/settings"
      ? settingsModules.find(
          ([id]) => id === new URLSearchParams(query).get("tab"),
        )
      : undefined;
  const articleCategories = navigation.find(
    (item) => item.to === "/articles",
  )!.children!;
  return (
    <header
      data-slot="workspace-topbar"
      className={cn(
        "flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4",
        android && "h-12 gap-2 px-2",
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={
          android && settingsTab
            ? () => window.dispatchEvent(new Event("pressdock-settings-back"))
            : onMenu
        }
        aria-label={android && settingsTab ? "返回上一级" : "切换导航"}
      >
        {android && settingsTab ? <ArrowLeft /> : <PanelLeft />}
      </Button>
      {!android && (
        <>
          <span
            className={cn(
              pathname === "/channels" || pathname === "/dashboard"
                ? "hidden min-w-0 truncate text-sm whitespace-nowrap text-muted-foreground lg:block"
                : "hidden text-sm text-muted-foreground md:block",
            )}
          >
            工作空间 <span className="px-2 text-border">/</span>{" "}
            <span className="text-foreground">
              {current?.label ?? "PressDock"}
            </span>
          </span>
          <form
            className={cn(
              "relative ml-auto min-w-0 flex-1 sm:w-60 sm:flex-none",
              pathname === "/channels" &&
                "sm:w-auto sm:flex-1 xl:w-60 xl:flex-none",
            )}
            onSubmit={(e) => {
              e.preventDefault();
              const target = /^\/articles\/(quality|review-[123])$/.test(
                pathname,
              )
                ? pathname
                : "/articles/quality";
              navigate(
                `${target}?${new URLSearchParams({ title: search, current: "1", pagesize: "50" })}`,
              );
            }}
          >
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input
              aria-label="搜索文章"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索文章，回车查看"
              className="h-9 bg-muted/40 pl-9"
            />
          </form>
          <Button
            variant="ghost"
            size="icon"
            aria-label="打开设置"
            onClick={() => navigate("/settings")}
          >
            <Settings />
          </Button>
          <AccountControls />
        </>
      )}
      {android && (
        <>
          {pathname.startsWith("/articles") ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="选择文章类别"
                  className="mr-auto min-w-0 px-2"
                >
                  <span className="truncate">
                    {current?.label ?? "文章管理"}
                  </span>
                  <ChevronDown data-icon="inline-end" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuGroup>
                  {articleCategories.map((item) => (
                    <DropdownMenuItem
                      key={item.to}
                      onSelect={() => navigate(item.to)}
                      aria-current={pathname === item.to ? "page" : undefined}
                    >
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <h1 className="mr-auto min-w-0 truncate text-sm font-medium">
              {settingsTab?.[1] ??
                (pathname === "/channels"
                  ? "渠道素材"
                  : (current?.label ?? "PressDock"))}
            </h1>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label="账号与外观"
            onClick={onMenu}
          >
            <UserRound />
          </Button>
        </>
      )}
    </header>
  );
}
