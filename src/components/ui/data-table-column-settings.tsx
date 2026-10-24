import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { ColumnPreferencesController } from "@/hooks/use-column-preferences";

export function DataTableColumnSettings({
  controller,
  disabled = false,
}: {
  controller: ColumnPreferencesController;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <Settings2 className="size-4" />
          列配置
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>显示列</DropdownMenuLabel>
        {controller.columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={
              column.enableHiding === false ||
              controller.preferences.visibility[column.id] !== false
            }
            disabled={disabled || column.enableHiding === false}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => {
              if (!disabled && column.enableHiding !== false)
                controller.setVisibility((previous) => ({
                  ...previous,
                  [column.id]: checked === true,
                }));
            }}
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={disabled} onSelect={controller.reset}>
          恢复默认
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
