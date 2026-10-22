import { useAtom } from "jotai";
import { useNavigate, useLocation } from "react-router-dom";
import { Search, Sun, Moon, Monitor, Settings, PanelLeft } from "lucide-react";
import { themeAtom, type Theme } from "@/atoms/theme";
import { globalSearchAtom } from "@/atoms/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { navigation } from "./navigation";

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const [theme, setTheme] = useAtom(themeAtom);
  const [search, setSearch] = useAtom(globalSearchAtom);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const current = navigation.find((item) =>
    pathname.startsWith(item.to.split("/demo")[0]),
  );
  const choices: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "浅色", icon: Sun },
    { value: "dark", label: "深色", icon: Moon },
    { value: "system", label: "跟随系统", icon: Monitor },
  ];
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
      <Button
        variant="ghost"
        size="icon"
        onClick={onMenu}
        aria-label="切换导航"
      >
        <PanelLeft className="size-4" />
      </Button>
      <span className="hidden text-sm text-muted-foreground md:block">
        工作空间 <span className="px-2 text-border">/</span>{" "}
        <span className="text-foreground">{current?.label ?? "PressDock"}</span>
      </span>
      <form
        className="relative ml-auto min-w-0 flex-1 sm:w-60 sm:flex-none"
        onSubmit={(e) => {
          e.preventDefault();
          navigate("/articles");
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="切换主题">
            {theme === "dark" ? (
              <Moon className="size-4" />
            ) : theme === "system" ? (
              <Monitor className="size-4" />
            ) : (
              <Sun className="size-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {choices.map(({ value, label, icon: Icon }) => (
            <DropdownMenuItem key={value} onSelect={() => setTheme(value)}>
              <Icon className="size-4" />
              {label}
              {theme === value && " ✓"}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="icon"
        aria-label="打开设置"
        onClick={() => navigate("/settings")}
      >
        <Settings className="size-4" />
      </Button>
    </header>
  );
}
