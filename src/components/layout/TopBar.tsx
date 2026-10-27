import { useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { editorDirtyAtom } from "@/atoms/editor";
import { useAuth } from "@/hooks/use-auth";
import { authService } from "@/features/auth/service";
import { toast } from "sonner";
import { ServiceError } from "@/services/tauri/client";

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const [theme, setTheme] = useAtom(themeAtom);
  const [search, setSearch] = useAtom(globalSearchAtom);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const auth = useAuth();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [dirty, setDirty] = useAtom(editorDirtyAtom);
  async function logout() {
    setConfirmLogout(false);
    setDirty(false);
    try {
      const result = await authService.logout();
      if (!result.credentialsCleared)
        toast.error("已退出当前会话，但安全凭据未能禁用。请检查应用数据目录。");
      else if (!result.remoteSucceeded)
        toast.warning("已退出本地会话，后台退出请求未成功。");
    } catch (reason) {
      if (reason instanceof ServiceError && reason.code === "SESSION_CHANGED")
        return;
      toast.error(
        "已退出界面，但无法确认本地凭据清理结果，请重试退出或重启应用检查。",
      );
    }
  }
  const current = navigation
    .flatMap((item) => item.children ?? [item])
    .find((item) => pathname.startsWith(item.to));
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
          // 顶部搜索提交到当前文章类别；其他页面默认查询优质文章。
          const target = /^\/articles\/(quality|review-[123])$/.test(pathname)
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label="账号菜单">
            {auth.session?.user.nickname}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setConfirmLogout(true)}>
            退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={confirmLogout} onOpenChange={setConfirmLogout}>
        <DialogContent>
          <DialogTitle>退出登录？</DialogTitle>
          <DialogDescription>
            {dirty
              ? "当前有未保存修改，退出后将丢失。取消退出可返回保存修改。"
              : "退出后需要重新登录才能进入工作区。"}
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmLogout(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void logout()}>
              {dirty ? "放弃修改并退出" : "确认退出"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
