import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { Monitor, Database, Plug, Sparkles, Info } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { themeAtom, type Theme } from "@/atoms/theme";
import { systemService, type AppInfo } from "@/services/tauri/system";
import { isDesktop } from "@/services/tauri/client";
import { APP_NAME, APP_VERSION } from "@/constants/app";
import { useAuth } from "@/hooks/use-auth";

export default function Settings() {
  const [theme, setTheme] = useAtom(themeAtom);
  const auth = useAuth();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [health, setHealth] = useState("正在检查…");
  useEffect(() => {
    let active = true;
    if (!isDesktop()) {
      setHealth("浏览器预览，Rust 服务不可用");
      return;
    }
    Promise.all([systemService.getAppInfo(), systemService.healthCheck()])
      .then(([app, status]) => {
        if (active) {
          setInfo(app);
          setHealth(status.ready ? "Rust 与 SQLite 已就绪" : "后端尚未就绪");
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          const message =
            reason instanceof Error ? reason.message : "后端连接失败";
          setHealth(message);
          toast.error(message);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <>
      <PageHeader
        title="系统设置"
        description="管理工作区外观与服务连接。"
        demo={false}
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Monitor className="size-4" />
              外观
            </CardTitle>
            <CardDescription>
              主题自动保存，重新打开应用后仍然生效。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <label htmlFor="theme-select" className="text-sm">
              界面主题
            </label>
            <Select
              value={theme}
              onValueChange={(value) => setTheme(value as Theme)}
            >
              <SelectTrigger
                id="theme-select"
                aria-label="界面主题"
                className="w-40"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">跟随系统</SelectItem>
                <SelectItem value="light">浅色</SelectItem>
                <SelectItem value="dark">深色</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="size-4" />
              本地服务
            </CardTitle>
            <CardDescription>
              桌面端通过类型化 IPC 检查后端与数据库。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm" role="status">
              {health}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {info
                ? `运行平台：${info.platform}`
                : "数据库：应用数据目录 / pressdock.db（桌面端）"}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Plug className="size-4" />
              CMS 连接
            </CardTitle>
            <Badge variant="secondary">已登录 · 只读素材</Badge>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>新闻管理后台 · newsadmin.nccontrol.com.cn</p>
            <p>
              当前账号：{auth.session?.user.nickname} · 角色：
              {auth.session?.user.roles.join("、")}
            </p>
            <p>
              {auth.session?.persistent
                ? "会话已安全保存，重启后验证恢复。"
                : "会话仅本次运行有效，关闭后需要重新登录。"}
            </p>
            <p>渠道素材支持筛选和查看；发布接口尚未接入。</p>
          </CardContent>
        </Card>
        {[
          {
            title: "AI 服务",
            icon: Sparkles,
            text: "预留标题建议与段落整理能力。密钥将由原生安全凭据服务管理。",
          },
        ].map(({ title, icon: Icon, text }) => (
          <Card key={title} className="shadow-none">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Icon className="size-4" />
                {title}
              </CardTitle>
              <Badge variant="outline">尚未配置</Badge>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {text}
              </p>
            </CardContent>
          </Card>
        ))}
        <Card className="shadow-none xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="size-4" />
              关于应用
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-semibold">
                {info?.name ?? APP_NAME}{" "}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  v{info?.version ?? APP_VERSION}
                  {!info && " · 前端版本"}
                </span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                News Editorial Workspace
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              本地优先 · 原文保留 · 模块化编辑流程
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
