// Adapted from Dice UI's Radix Data Table (MIT).
// Source and license: docs/third-party/dice-ui.md.
import {
  columnPinningFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  metaHelper,
  tableFeatures,
  type Column,
  type ColumnDef,
  type ReactTable,
  type RowData,
} from "@tanstack/react-table";
import type { CSSProperties } from "react";

export const dataTableFeatures = tableFeatures({
  columnPinningFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  columnMeta: metaHelper<{ label: string; resizable?: boolean }>(),
});
export type DataTableFeatures = typeof dataTableFeatures;
export type DataTableColumnDef<TData extends RowData> = ColumnDef<
  DataTableFeatures,
  TData
>;
export type DataTableInstance<TData extends RowData> = ReactTable<
  DataTableFeatures,
  TData
>;

export function getColumnPinningStyle<TData extends RowData>(
  column: Column<DataTableFeatures, TData>,
): CSSProperties {
  const pinned = column.getIsPinned();
  return {
    position: pinned ? "sticky" : "relative",
    insetInlineStart: pinned === "start" ? column.getStart("start") : undefined,
    insetInlineEnd: pinned === "end" ? column.getAfter("end") : undefined,
    width: column.getSize(),
    zIndex: pinned ? 10 : undefined,
  };
}
