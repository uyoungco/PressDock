import { useState } from "react";
import { useAtom } from "jotai";
import { Sun, Moon, Monitor, LogOut } from "lucide-react";
import { toast } from "sonner";
import { themeAtom, type Theme } from "@/atoms/theme";
import { editorDirtyAtom } from "@/atoms/editor";
import { useAuth } from "@/hooks/use-auth";
import { authService } from "@/features/auth/service";
import { ServiceError } from "@/services/tauri/client";
import { isAndroid, isDemo } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const choices: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
];
export function AccountControls({ mobile = false }: { mobile?: boolean }) {
  const [theme, setTheme] = useAtom(themeAtom);
  const [dirty, setDirty] = useAtom(editorDirtyAtom);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const auth = useAuth();
  async function logout() {
    setConfirmLogout(false);
    setDirty(false);
    try {
      const result = await authService.logout();
      if (!result.credentialsCleared)
        toast.error("已退出当前会话，但安全凭据未能禁用。请检查应用数据目录。");
      else if (!isDemo() && !result.remoteSucceeded)
        toast.warning("已退出本地会话，后台退出请求未成功。");
    } catch (reason) {
      if (reason instanceof ServiceError && reason.code === "SESSION_CHANGED")
        return;
      toast.error(
        "已退出界面，但无法确认本地凭据清理结果，请重试退出或重启应用检查。",
      );
    }
  }
  return (
    <>
      {mobile ? (
        <div
          data-slot="mobile-account"
          className="flex shrink-0 flex-col gap-3"
        >
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate" title={auth.session?.user.nickname}>
                {auth.session?.user.nickname || "当前账号"}
              </p>
              <p className="text-xs text-muted-foreground">当前登录账号</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="退出登录"
              onClick={() => setConfirmLogout(true)}
            >
              <LogOut />
            </Button>
          </div>
          <ToggleGroup
            type="single"
            value={theme}
            onValueChange={(value) => {
              if (value) setTheme(value as Theme);
            }}
            variant="outline"
            aria-label="外观"
            className="w-full"
          >
            {choices.map(({ value, label, icon: Icon }) => (
              <ToggleGroupItem
                key={value}
                value={value}
                aria-label={label}
                className="flex-1"
              >
                <Icon />
                {value === "system" ? "系统" : label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      ) : (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="切换主题">
                {theme === "dark" ? (
                  <Moon />
                ) : theme === "system" ? (
                  <Monitor />
                ) : (
                  <Sun />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                {choices.map(({ value, label, icon: Icon }) => (
                  <DropdownMenuItem
                    key={value}
                    onSelect={() => setTheme(value)}
                  >
                    <Icon />
                    {label}
                    {theme === value && " ✓"}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label="账号菜单">
                {auth.session?.user.nickname}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => setConfirmLogout(true)}>
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      <Dialog open={confirmLogout} onOpenChange={setConfirmLogout}>
        <DialogContent>
          <DialogTitle>退出登录？</DialogTitle>
          <DialogDescription>
            {isAndroid()
              ? "退出后需要重新登录，并会清除此设备尚未提交的素材和文章草稿。"
              : dirty
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
    </>
  );
}
