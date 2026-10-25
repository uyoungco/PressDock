import { Monitor, Database, Plug, Sparkles, Info } from "lucide-react";
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
import type { Theme } from "@/atoms/theme";
import type { AppInfo } from "@/services/tauri/system";
import type { AuthSession } from "@/types/cms";
import { APP_NAME, APP_VERSION } from "@/constants/app";

const themeOptions: { value: Theme; label: string }[] = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

export function GeneralSettings({
  theme,
  onThemeChange,
}: {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}) {
  return (
    <Card className="min-w-0 shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Monitor className="size-4" />
          外观
        </CardTitle>
        <CardDescription>
          主题自动保存，重新打开应用后仍然生效。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor="theme-select" className="text-sm">
          界面主题
        </label>
        <Select<Theme>
          items={themeOptions}
          value={theme}
          onValueChange={(value) => {
            if (value !== null) onThemeChange(value);
          }}
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
  );
}

export function ServiceConnections({
  health,
  info,
  session,
}: {
  health: string;
  info: AppInfo | null;
  session: AuthSession | null;
}) {
  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-2">
      <Card className="min-w-0 shadow-none">
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
      <Card className="min-w-0 shadow-none">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Plug className="size-4" />
            CMS 连接
          </CardTitle>
          <Badge variant="secondary">已登录 · 只读素材</Badge>
        </CardHeader>
        <CardContent className="space-y-2 text-sm break-words text-muted-foreground">
          <p>新闻管理后台 · newsadmin.nccontrol.com.cn</p>
          <p>
            当前账号：{session?.user.nickname} · 角色：
            {session?.user.roles.join("、")}
          </p>
          <p>
            {session?.persistent
              ? "会话已安全保存，重启后验证恢复。"
              : "会话仅本次运行有效，关闭后需要重新登录。"}
          </p>
          <p>渠道素材支持筛选和查看；发布接口尚未接入。</p>
        </CardContent>
      </Card>
      <Card className="min-w-0 shadow-none">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4" />
            AI 服务
          </CardTitle>
          <Badge variant="outline">可配置</Badge>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-muted-foreground">
            在“AI
            模型”配置连接，在“提示词模板”设置标题优化规则。密钥由系统安全凭据库管理。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export function AboutApplication({ info }: { info: AppInfo | null }) {
  return (
    <Card className="min-w-0 shadow-none">
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
  );
}
