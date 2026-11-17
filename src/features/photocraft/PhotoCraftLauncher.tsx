import { useRef, useState } from "react";
import { Paintbrush } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isAppRuntime } from "@/services/tauri/client";
import { photoCraftService } from "./service";

export function PhotoCraftLauncher({ expanded }: { expanded: boolean }) {
  const opening = useRef(false);
  const [pending, setPending] = useState(false);
  // 桌面布局也用于浏览器预览；只有原生运行时才提供独立窗口入口。
  if (!isAppRuntime()) return null;

  async function open() {
    // ref 在同一帧内阻止连点，窗口本身仍由 Rust 按固定标识复用。
    if (opening.current) return;
    opening.current = true;
    setPending(true);
    try {
      await photoCraftService.open();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "无法打开 PhotoCraft",
      );
    } finally {
      opening.current = false;
      setPending(false);
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          aria-label="打开 PhotoCraft"
          aria-busy={pending}
          disabled={pending}
          className="min-h-10 w-full justify-start gap-3 px-3"
          onClick={() => void open()}
        >
          <Paintbrush data-icon="inline-start" />
          {expanded && "PhotoCraft"}
        </Button>
      </TooltipTrigger>
      {!expanded && <TooltipContent side="right">PhotoCraft</TooltipContent>}
    </Tooltip>
  );
}
