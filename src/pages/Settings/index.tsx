import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { themeAtom } from "@/atoms/theme";
import { systemService, type AppInfo } from "@/services/tauri/system";
import { isDesktop } from "@/services/tauri/client";
import { useAuth } from "@/hooks/use-auth";
import { ImagePresetSettings } from "@/features/image-presets/ImagePresetSettings";
import {
  GeneralSettings,
  ServiceConnections,
  AboutApplication,
} from "./sections";

export default function Settings() {
  const [tab, setTab] = useState("general");
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
        description="管理工作区外观、图片预设与服务连接。"
        demo={false}
      />
      <Tabs value={tab} onValueChange={setTab} className="min-w-0 gap-5">
        <div className="min-w-0 overflow-x-auto pb-1">
          <TabsList aria-label="设置模块" className="h-10! min-w-max">
            <TabsTrigger value="general" className="px-4">
              常规设置
            </TabsTrigger>
            <TabsTrigger value="image-presets" className="px-4">
              图片预设
            </TabsTrigger>
            <TabsTrigger value="services" className="px-4">
              服务连接
            </TabsTrigger>
            <TabsTrigger value="about" className="px-4">
              关于应用
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="general" className="min-w-0">
          <GeneralSettings theme={theme} onThemeChange={setTheme} />
        </TabsContent>
        <TabsContent
          value="image-presets"
          forceMount
          hidden={tab !== "image-presets"}
          className="min-w-0"
        >
          <ImagePresetSettings />
        </TabsContent>
        <TabsContent value="services" className="min-w-0">
          <ServiceConnections
            health={health}
            info={info}
            session={auth.session}
          />
        </TabsContent>
        <TabsContent value="about" className="min-w-0">
          <AboutApplication info={info} />
        </TabsContent>
      </Tabs>
    </>
  );
}
