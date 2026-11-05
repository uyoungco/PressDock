import {
  useCallback,
  useEffect,
  useState,
  type ComponentProps,
  type ContextType,
} from "react";
import {
  useBeforeUnload,
  useBlocker,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { HarvestSettings } from "@/features/import/HarvestSettings";
import { ImagePresetSettings } from "@/features/image-presets/ImagePresetSettings";
import { ModelSettings } from "@/features/ai/ModelSettings";
import { TemplateSettings } from "@/features/ai/TemplateSettings";
import { MobileSettingsContext } from "@/features/settings/mobile-state";
import {
  GeneralSettings,
  ServiceConnections,
  AboutApplication,
} from "./sections";

const modules = [
  ["general", "常规设置"],
  ["harvest", "采集与 AI 处理"],
  ["image-presets", "图片预设"],
  ["services", "服务连接"],
  ["ai-models", "AI 模型"],
  ["ai-templates", "提示词模板"],
  ["about", "关于应用"],
] as const;
type State = {
  settingsEditor?: NonNullable<
    ContextType<typeof MobileSettingsContext>
  >["editor"];
  settingsProvider?: string | null;
};

export default function MobileSettings({
  theme,
  onThemeChange,
  health,
  info,
  session,
}: ComponentProps<typeof GeneralSettings> &
  ComponentProps<typeof ServiceConnections>) {
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = modules.find(([id]) => id === params.get("tab"))?.[0] ?? null;
  const purpose: "title" | "pagination" =
    params.get("purpose") === "pagination" ? "pagination" : "title";
  const state: State = location.state ?? {};
  const [visited, setVisited] = useState<string[]>(tab ? [tab] : []);
  const [drafts, setDrafts] = useState<
    Record<string, { dirty: boolean; busy: boolean }>
  >({});
  const report = useCallback((key: string, dirty: boolean, busy: boolean) => {
    setDrafts((previous) =>
      previous[key]?.dirty === dirty && previous[key]?.busy === busy
        ? previous
        : { ...previous, [key]: { dirty, busy } },
    );
  }, []);
  const dirty = Object.values(drafts).some((draft) => draft.dirty);
  const busy = Object.values(drafts).some((draft) => draft.busy);
  // 分项和编辑层级可回退；只有离开设置工作区才检查未保存输入。
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname && (dirty || busy),
  );
  useBeforeUnload(
    useCallback(
      (event) => {
        if (dirty || busy) {
          event.preventDefault();
          event.returnValue = "";
        }
      },
      [dirty, busy],
    ),
  );
  useEffect(() => {
    if (tab)
      setVisited((previous) =>
        previous.includes(tab) ? previous : [...previous, tab],
      );
  }, [tab]);
  const go = (nextTab: string | null, nextPurpose = purpose) => {
    const next = new URLSearchParams(params);
    if (nextTab) next.set("tab", nextTab);
    else next.delete("tab");
    if (nextTab === "ai-templates") next.set("purpose", nextPurpose);
    else next.delete("purpose");
    setParams(next, { state: null });
  };
  const back = () => {
    if (state.settingsEditor) void navigate(-1);
    else if (state.settingsProvider) void navigate(-1);
    else if (tab) go(null);
    else
      // 文章仅接受四个已知类别；查询由文章工作区按账号恢复，不接受任意返回 URL。
      void navigate(
        /^articles\/(quality|review-[123])$/.test(params.get("returnTo") ?? "")
          ? `/${params.get("returnTo")}`
          : params.get("returnTo") === "import"
            ? "/import"
            : "/channels",
      );
  };
  useEffect(() => {
    // Shell 处理浮层后，把设置自己的返回层级交给当前可见的页面。
    const handle = () => back();
    window.addEventListener("pressdock-settings-back", handle);
    return () => window.removeEventListener("pressdock-settings-back", handle);
  });
  const context = {
    editor: state.settingsEditor ?? null,
    providerId: state.settingsProvider ?? null,
    purpose,
    openEditor: (editor: NonNullable<State["settingsEditor"]>) => {
      void navigate(`${location.pathname}${location.search}`, {
        state: { ...state, settingsEditor: editor },
        replace: !!state.settingsEditor,
      });
    },
    closeEditor: () => {
      void navigate(-1);
    },
    selectProvider: (id: string | null) => {
      // 删除当前提供商后退回原列表，避免再增加一层空详情历史。
      if (id === null) {
        void navigate(-1);
        return;
      }
      void navigate(`${location.pathname}${location.search}`, {
        state: { settingsProvider: id },
      });
    },
    changePurpose: (next: "title" | "pagination") => go("ai-templates", next),
    report,
  };
  return (
    <MobileSettingsContext.Provider value={context}>
      <section
        data-mobile-settings
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-3"
      >
        <header className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="返回上一级"
            onClick={back}
          >
            <ArrowLeft />
          </Button>
          <h1 className="text-lg font-semibold">
            {modules.find(([id]) => id === tab)?.[1] ?? "系统设置"}
          </h1>
        </header>
        {!tab && (
          <ScrollArea className="flex-1">
            <nav aria-label="设置模块" className="flex flex-col gap-2">
              {modules.map(([id, label]) => (
                <Button
                  key={id}
                  variant="outline"
                  className="h-auto justify-between whitespace-normal py-4 text-left"
                  onClick={() => go(id)}
                >
                  {label}
                  <ChevronRight data-icon="inline-end" />
                </Button>
              ))}
            </nav>
          </ScrollArea>
        )}
        {[...new Set([...visited, ...(tab ? [tab] : [])])].map((id) => (
          <div
            key={id}
            hidden={tab !== id}
            className="min-h-0 min-w-0 flex-1 flex-col data-[active=true]:flex"
            data-active={tab === id}
          >
            {id === "image-presets" ? (
              <ImagePresetSettings />
            ) : (
              <ScrollArea
                className="flex-1"
                viewportProps={{ className: "overscroll-contain" }}
              >
                {id === "general" && (
                  <GeneralSettings
                    theme={theme}
                    onThemeChange={onThemeChange}
                  />
                )}
                {id === "harvest" && (
                  <HarvestSettings
                    active={tab === id}
                    onConfigurePagination={() =>
                      go("ai-templates", "pagination")
                    }
                  />
                )}
                {id === "services" && (
                  <ServiceConnections
                    health={health}
                    info={info}
                    session={session}
                  />
                )}
                {id === "ai-models" && <ModelSettings active={tab === id} />}
                {id === "ai-templates" && (
                  <TemplateSettings active={tab === id} />
                )}
                {id === "about" && <AboutApplication info={info} />}
              </ScrollArea>
            )}
          </div>
        ))}
      </section>
      <Dialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.state === "blocked") blocker.reset();
        }}
      >
        <DialogContent data-import-dialog="settings-leave">
          <DialogTitle>离开系统设置？</DialogTitle>
          <DialogDescription>
            {busy
              ? "操作正在进行，请等待完成后再离开。"
              : "尚有未保存的修改，离开将放弃这些输入。"}
          </DialogDescription>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => blocker.state === "blocked" && blocker.reset()}
            >
              继续编辑
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => blocker.state === "blocked" && blocker.proceed()}
            >
              放弃并离开
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MobileSettingsContext.Provider>
  );
}
