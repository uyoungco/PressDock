// Adapted from Dice UI's Radix Data Table (MIT), with local state and scrolling.
// Source and license: docs/third-party/dice-ui.md.
import { FlexRender, type Row, type RowData } from "@tanstack/react-table";
import { Fragment, type HTMLAttributes, type ReactNode } from "react";
import {
  getColumnPinningStyle,
  type DataTableFeatures,
  type DataTableInstance,
} from "@/lib/data-table";
import { cn } from "@/lib/utils";
import { DataTableResizeHandle } from "./data-table-resize-handle";

interface DataTableProps<TData extends RowData> {
  table: DataTableInstance<TData>;
  "aria-label": string;
  externalScroll?: boolean;
  resizeDisabled?: boolean;
  emptyMessage?: ReactNode;
  footer?: ReactNode;
  getRowProps?: (
    row: Row<DataTableFeatures, TData>,
  ) => HTMLAttributes<HTMLTableRowElement>;
}

export function DataTable<TData extends RowData>({
  table,
  "aria-label": ariaLabel,
  externalScroll = false,
  resizeDisabled = false,
  emptyMessage = "暂无符合条件的数据",
  footer,
  getRowProps,
}: DataTableProps<TData>) {
  return (
    <div data-slot="data-table" className="min-w-0">
      <div className={externalScroll ? undefined : "isolate overflow-x-auto"}>
        <table.Subscribe
          selector={(state) => ({
            columnPinning: state.columnPinning,
            columnSizing: state.columnSizing,
            columnVisibility: state.columnVisibility,
          })}
        >
          {() => {
            const rows = table.getRowModel().rows;
            if (!rows.length)
              return (
                <div
                  role="status"
                  className="flex min-h-48 items-center justify-center text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </div>
              );
            return (
              <table
                aria-label={ariaLabel}
                className="min-w-full table-fixed text-left text-sm"
                style={{ width: table.getTotalSize() }}
              >
                <thead className="sticky top-0 z-20 bg-muted text-xs text-muted-foreground">
                  {table.getHeaderGroups().map((group) => (
                    <tr key={group.id}>
                      {group.headers.map((header, index) => (
                        <Fragment key={header.id}>
                          {/* 多余空间由留白吸收，避免浏览器按比例拉伸数据列。 */}
                          {index === group.headers.length - 1 && (
                            <th
                              aria-hidden="true"
                              className="border-b bg-muted"
                            />
                          )}
                          <th
                            aria-label={header.column.columnDef.meta?.label}
                            colSpan={header.colSpan}
                            className={cn(
                              "relative border-b bg-muted px-4 py-3 pr-5 font-medium",
                              header.column.getIsPinned() && "z-30",
                            )}
                            style={getColumnPinningStyle(header.column)}
                          >
                            <div className="truncate">
                              {header.isPlaceholder ? null : (
                                <FlexRender header={header} />
                              )}
                            </div>
                            {header.column.columnDef.meta?.resizable !==
                              false && (
                              <DataTableResizeHandle
                                column={header.column}
                                disabled={resizeDisabled}
                              />
                            )}
                          </th>
                        </Fragment>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const props = getRowProps?.(row);
                    return (
                      <tr
                        key={row.id}
                        {...props}
                        className={cn(
                          "group/row border-b last:border-0 hover:bg-muted/30",
                          props?.className,
                        )}
                      >
                        {row.getVisibleCells().map((cell, index, cells) => (
                          <Fragment key={cell.id}>
                            {index === cells.length - 1 && (
                              <td aria-hidden="true" />
                            )}
                            <td
                              className={cn(
                                "overflow-hidden px-4 py-3",
                                cell.column.getIsPinned() &&
                                  "bg-card group-hover/row:bg-muted",
                              )}
                              style={getColumnPinningStyle(cell.column)}
                            >
                              <div className="min-w-0">
                                <FlexRender cell={cell} />
                              </div>
                            </td>
                          </Fragment>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          }}
        </table.Subscribe>
      </div>
      {footer}
    </div>
  );
}
