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
import { ScrollArea } from "@/components/ui/scroll-area";

interface DataTableProps<TData extends RowData> {
  table: DataTableInstance<TData>;
  "aria-label": string;
  externalScroll?: boolean;
  resizeDisabled?: boolean;
  density?: "default" | "compact";
  stretchColumnId?: string;
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
  density = "default",
  stretchColumnId,
  emptyMessage = "暂无符合条件的数据",
  footer,
  getRowProps,
}: DataTableProps<TData>) {
  const content = (
    <table.Subscribe
      selector={(state) => ({
        columnPinning: state.columnPinning,
        columnSizing: state.columnSizing,
        columnVisibility: state.columnVisibility,
      })}
    >
      {({ columnSizing }) => {
        const rows = table.getRowModel().rows;
        const stretch =
          stretchColumnId && columnSizing[stretchColumnId] === undefined;
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
            data-density={density}
            style={
              stretch
                ? { width: "100%", minWidth: table.getTotalSize() }
                : { width: table.getTotalSize() }
            }
          >
            {stretch && (
              <colgroup>
                {table.getVisibleLeafColumns().map((column) => (
                  <col
                    key={column.id}
                    style={{
                      width:
                        column.id === stretchColumnId
                          ? undefined
                          : column.getSize(),
                    }}
                  />
                ))}
              </colgroup>
            )}
            <thead className="sticky top-0 z-20 bg-muted text-xs text-muted-foreground">
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header, index) => (
                    <Fragment key={header.id}>
                      {/* 多余空间由留白吸收，避免浏览器按比例拉伸数据列。 */}
                      {!stretch && index === group.headers.length - 1 && (
                        <th aria-hidden="true" className="border-b bg-muted" />
                      )}
                      <th
                        aria-label={header.column.columnDef.meta?.label}
                        colSpan={header.colSpan}
                        className={cn(
                          "relative border-b bg-muted px-4 py-3 pr-5 font-medium",
                          density === "compact" && "h-8 px-3 py-1.5 pr-4",
                          density === "compact" &&
                            header.column.columnDef.meta?.resizable === false &&
                            "px-2",
                          header.column.getIsPinned() && "z-30",
                        )}
                        style={{
                          ...getColumnPinningStyle(header.column),
                          ...(stretch &&
                            header.column.id === stretchColumnId && {
                              width: undefined,
                            }),
                          ...(header.column.getIsPinned() && { zIndex: 30 }),
                        }}
                      >
                        <div className="truncate">
                          {header.isPlaceholder ? null : (
                            <FlexRender header={header} />
                          )}
                        </div>
                        {header.column.columnDef.meta?.resizable !== false && (
                          <DataTableResizeHandle
                            column={header.column}
                            disabled={resizeDisabled}
                            useRenderedSize={
                              !!stretch && header.column.id === stretchColumnId
                            }
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
                        {!stretch && index === cells.length - 1 && (
                          <td aria-hidden="true" />
                        )}
                        <td
                          className={cn(
                            "overflow-hidden px-4 py-3",
                            density === "compact" &&
                              "h-[72px] px-3 py-2 align-middle",
                            cell.column.getIsPinned() &&
                              "bg-card group-hover/row:bg-muted",
                          )}
                          style={{
                            ...getColumnPinningStyle(cell.column),
                            ...(stretch &&
                              cell.column.id === stretchColumnId && {
                                width: undefined,
                              }),
                          }}
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
  );
  return (
    <div data-slot="data-table" className="min-w-0">
      {externalScroll ? (
        content
      ) : (
        <ScrollArea
          orientation="horizontal"
          className="isolate"
          viewportProps={{ tabIndex: 0, "aria-label": `${ariaLabel}滚动区域` }}
        >
          {content}
        </ScrollArea>
      )}
      {footer}
    </div>
  );
}
