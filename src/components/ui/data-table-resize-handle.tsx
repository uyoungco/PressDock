import { useRef } from "react";
import type { Column, RowData } from "@tanstack/react-table";
import type { DataTableFeatures } from "@/lib/data-table";

export function DataTableResizeHandle<TData extends RowData>({
  column,
  disabled,
}: {
  column: Column<DataTableFeatures, TData>;
  disabled: boolean;
}) {
  const drag = useRef<{ pointer: number; x: number; size: number } | null>(
    null,
  );
  const min = column.columnDef.minSize ?? 64;
  const max = column.columnDef.maxSize ?? 960;
  function resize(size: number) {
    column.table.setColumnSizing((previous) => ({
      ...previous,
      [column.id]: Math.min(max, Math.max(min, Math.round(size))),
    }));
  }
  return (
    <div
      role="separator"
      aria-label={`调整 ${column.columnDef.meta?.label ?? column.id} 列宽`}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={column.getSize()}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      className="absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize touch-none select-none hover:bg-ring/40 focus-visible:bg-ring/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring aria-disabled:cursor-default aria-disabled:hover:bg-transparent"
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        drag.current = {
          pointer: event.pointerId,
          x: event.clientX,
          size: column.getSize(),
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!disabled && start && event.pointerId === start.pointer)
          resize(start.size + event.clientX - start.x);
      }}
      onPointerUp={(event) => {
        const start = drag.current;
        if (!disabled && start && event.pointerId === start.pointer)
          resize(start.size + event.clientX - start.x);
        drag.current = null;
        if (event.currentTarget.hasPointerCapture?.(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onDoubleClick={() => {
        if (!disabled) column.resetSize();
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          resize(
            column.getSize() +
              (event.key === "ArrowRight" ? 1 : -1) *
                (event.shiftKey ? 50 : 10),
          );
        } else if (event.key === "Home") {
          event.preventDefault();
          column.resetSize();
        }
      }}
    />
  );
}
