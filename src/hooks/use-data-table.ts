import { useTable, type RowData } from "@tanstack/react-table";
import { dataTableFeatures, type DataTableColumnDef } from "@/lib/data-table";
import type { ColumnPreferencesController } from "./use-column-preferences";

const noPinnedColumns: string[] = [];

/** 仅管理展示列；数据顺序、筛选和分页由业务服务及路由管理。 */
export function useDataTable<TData extends RowData>({
  data,
  columns,
  preferences,
  getRowId,
  pinnedEnd = noPinnedColumns,
}: {
  data: TData[];
  columns: DataTableColumnDef<TData>[];
  preferences: ColumnPreferencesController;
  getRowId: (row: TData) => string;
  pinnedEnd?: string[];
}) {
  return useTable({
    features: dataTableFeatures,
    data,
    columns,
    getRowId,
    state: {
      columnVisibility: preferences.preferences.visibility,
      columnSizing: preferences.preferences.sizing,
      columnPinning: { start: noPinnedColumns, end: pinnedEnd },
    },
    onColumnVisibilityChange: preferences.setVisibility,
    onColumnSizingChange: preferences.setSizing,
  });
}
