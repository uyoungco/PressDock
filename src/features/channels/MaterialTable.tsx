import { createContext, useContext } from "react";
import type { CellContext } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Copy, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { useDataTable } from "@/hooks/use-data-table";
import type { ColumnPreferencesController } from "@/hooks/use-column-preferences";
import type { DataTableColumnDef, DataTableFeatures } from "@/lib/data-table";
import { MaterialImage } from "./MaterialImage";
import { channelService } from "./service";
import type { PromoteField, PromoteRecord } from "@/types/cms";
import { materialColumnPreferences, articleUrl } from "./table-model";
import { useMaterialDrag } from "./use-material-drag";

const show = (value: string | number | null) =>
  value === null || value === "" ? "—" : String(value);
async function open(url: string) {
  try {
    await channelService.openLink(url);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "打开链接失败");
  }
}
async function copy(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success("已复制");
  } catch {
    toast.error("复制失败，请手动选择文本复制");
  }
}
interface MaterialTableProps {
  rows: PromoteRecord[];
  sorting: boolean;
  busy: boolean;
  preferences: ColumnPreferencesController;
  onMove: (from: number, to: number) => void;
  onDetail: (row: PromoteRecord) => void;
  onEdit: (row: PromoteRecord) => void;
  onDelete: (row: PromoteRecord) => void;
}
interface MaterialContext extends MaterialTableProps {
  drag: ReturnType<typeof useMaterialDrag>;
}
const MaterialTableContext = createContext<MaterialContext | null>(null);
function useMaterialContext() {
  const context = useContext(MaterialTableContext);
  if (!context) throw new Error("素材单元格必须位于素材表格中");
  return context;
}
type MaterialCellContext = CellContext<DataTableFeatures, PromoteRecord>;

function SortCell({ row: tableRow }: MaterialCellContext) {
  const row = tableRow.original,
    index = tableRow.index;
  const { busy, rows, onMove, drag } = useMaterialContext();
  return (
    <div className="flex items-center">
      <button
        aria-label={`拖动素材 ${row.id}`}
        {...drag.getHandleProps(row.id)}
        className="cursor-grab p-2"
      >
        <GripVertical className="pointer-events-none size-4" />
      </button>
      <Button
        size="icon"
        variant="ghost"
        aria-label={`上移素材 ${row.id}`}
        disabled={busy || index === 0}
        onClick={() => onMove(row.id, rows[index - 1].id)}
      >
        <ArrowUp className="size-3" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label={`下移素材 ${row.id}`}
        disabled={busy || index === rows.length - 1}
        onClick={() => onMove(row.id, rows[index + 1].id)}
      >
        <ArrowDown className="size-3" />
      </Button>
    </div>
  );
}

function MaterialCell({
  row: tableRow,
  field,
}: {
  row: MaterialCellContext["row"];
  field: PromoteField;
}) {
  const row = tableRow.original;
  const { sorting, onDetail } = useMaterialContext();
  if (field === "titlePic" || field === "titlePic2")
    return (
      <MaterialImage
        url={row[field]}
        compact
        label={field === "titlePic" ? "主图" : "第二张图片"}
        onPreview={() => onDetail(row)}
      />
    );
  if (field === "articleId" && articleUrl(row.articleId))
    return (
      <button
        role="link"
        className="max-w-full truncate text-primary hover:underline"
        onClick={() => void open(articleUrl(row.articleId)!)}
      >
        {row.articleId}
      </button>
    );
  if (field === "title")
    return (
      <button
        className="w-full text-left font-medium break-words hover:underline"
        onClick={() => onDetail(row)}
      >
        {show(row.title)}
      </button>
    );
  if (field === "url" || field === "landUrl")
    return (
      <div className="flex min-w-0 items-center gap-1">
        <button
          role="link"
          className="min-w-0 flex-1 truncate text-left text-primary hover:underline"
          title={row[field] ?? undefined}
          disabled={!row[field]}
          onClick={() => void open(row[field]!)}
        >
          {show(row[field])}
        </button>
        {row[field] && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={`复制 ${field} ${row.id}`}
            onClick={() => void copy(row[field]!)}
          >
            <Copy className="size-3" />
          </Button>
        )}
      </div>
    );
  if (field === "smallText")
    return (
      <p
        className="line-clamp-3 break-words"
        title={row.smallText ?? undefined}
      >
        {show(row.smallText)}
      </p>
    );
  return (
    <span className="block truncate" title={show(row[field])}>
      {show(sorting && field === "order" ? tableRow.index + 1 : row[field])}
    </span>
  );
}

function ActionsCell({ row: { original: row } }: MaterialCellContext) {
  const { busy, sorting, onDetail, onEdit, onDelete } = useMaterialContext();
  return (
    <div className="flex">
      <Button
        variant="ghost"
        size="sm"
        aria-label={`查看素材 ${row.id}`}
        onClick={() => onDetail(row)}
      >
        详情
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`编辑素材 ${row.id}`}
        disabled={busy || sorting}
        onClick={() => onEdit(row)}
      >
        编辑
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`删除素材 ${row.id}`}
        disabled={busy || sorting}
        onClick={() => onDelete(row)}
      >
        删除
      </Button>
    </div>
  );
}

// 列定义保持稳定：调整列宽不卸载图片，业务状态通过 Context 更新。
const columns: DataTableColumnDef<PromoteRecord>[] =
  materialColumnPreferences.map((config) => ({
    ...config,
    header: config.label,
    meta: { label: config.label },
    cell:
      config.id === "actions"
        ? ActionsCell
        : ({ row }) => (
            <MaterialCell row={row} field={config.id as PromoteField} />
          ),
  }));
const sortingColumns: DataTableColumnDef<PromoteRecord>[] = [
  {
    id: "drag",
    header: "拖动排序",
    size: 144,
    minSize: 144,
    maxSize: 144,
    enableHiding: false,
    meta: { label: "拖动排序", resizable: false },
    cell: SortCell,
  },
  ...columns,
];
const pinnedEnd = ["actions"];
const getRowId = (row: PromoteRecord) => String(row.id);

export function MaterialTable(props: MaterialTableProps) {
  const { rows, sorting, busy, onMove, preferences } = props;
  const drag = useMaterialDrag({ rows, sorting, busy, onMove });
  const table = useDataTable({
    data: rows,
    columns: sorting ? sortingColumns : columns,
    preferences,
    getRowId,
    pinnedEnd,
  });
  return (
    <MaterialTableContext value={{ ...props, drag }}>
      <DataTable
        table={table}
        aria-label="渠道素材列表"
        externalScroll
        resizeDisabled={sorting || busy}
        emptyMessage="暂无符合条件的素材"
        getRowProps={({ original: row }) => drag.getRowProps(row.id)}
      />
    </MaterialTableContext>
  );
}
