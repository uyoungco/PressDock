import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAtom } from "jotai";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { themeAtom } from "@/atoms/theme";
import { systemService, type AppInfo } from "@/services/tauri/system";
import { isDesktop } from "@/services/tauri/client";
import { useAuth } from "@/hooks/use-auth";
import { HarvestSettings } from "@/features/import/HarvestSettings";
import { ImagePresetSettings } from "@/features/image-presets/ImagePresetSettings";
import { ModelSettings } from "@/features/ai/ModelSettings";
import { TemplateSettings } from "@/features/ai/TemplateSettings";
import {
  GeneralSettings,
  ServiceConnections,
  AboutApplication,
} from "./sections";

export default function Settings() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(() =>
    ["ai-models", "ai-templates", "harvest"].includes(params.get("tab") ?? "")
      ? params.get("tab")!
      : "general",
  );
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
        description="管理采集与 AI 处理、工作区外观、图片预设和 AI 模型。"
        demo={false}
      />
      <Tabs value={tab} onValueChange={setTab} className="min-w-0 gap-5">
        <div className="min-w-0 overflow-x-auto pb-1">
          <TabsList aria-label="设置模块" className="h-10! min-w-max">
            <TabsTrigger value="general" className="px-4">
              常规设置
            </TabsTrigger>
            <TabsTrigger value="harvest" className="px-4">
              采集与 AI 处理
            </TabsTrigger>
            <TabsTrigger value="image-presets" className="px-4">
              图片预设
            </TabsTrigger>
            <TabsTrigger value="services" className="px-4">
              服务连接
            </TabsTrigger>
            <TabsTrigger value="ai-models" className="px-4">
              AI 模型
            </TabsTrigger>
            <TabsTrigger value="ai-templates" className="px-4">
              提示词模板
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
          value="harvest"
          forceMount
          hidden={tab !== "harvest"}
          className="min-w-0"
        >
          <HarvestSettings active={tab === "harvest"} />
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
        <TabsContent
          value="ai-models"
          forceMount
          hidden={tab !== "ai-models"}
          className="min-w-0"
        >
          <ModelSettings active={tab === "ai-models"} />
        </TabsContent>
        <TabsContent
          value="ai-templates"
          forceMount
          hidden={tab !== "ai-templates"}
          className="min-w-0"
        >
          <TemplateSettings active={tab === "ai-templates"} />
        </TabsContent>
      </Tabs>
    </>
  );
}
