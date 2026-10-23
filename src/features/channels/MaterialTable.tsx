import { useRef } from "react";
import { ArrowDown, ArrowUp, Copy, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MaterialImage } from "./MaterialImage";
import { channelService } from "./service";
import type { PromoteRecord } from "@/types/cms";
import { materialColumns, articleUrl } from "./table-model";

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
export function MaterialTable({
  rows,
  sorting,
  busy,
  onMove,
  onDetail,
  onEdit,
  onDelete,
}: {
  rows: PromoteRecord[];
  sorting: boolean;
  busy: boolean;
  onMove: (from: number, to: number) => void;
  onDetail: (row: PromoteRecord) => void;
  onEdit: (row: PromoteRecord) => void;
  onDelete: (row: PromoteRecord) => void;
}) {
  const dragging = useRef<number | null>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  return (
    <table className="w-full text-left text-sm" aria-label="渠道素材列表">
      <thead className="sticky top-0 z-20 bg-muted text-xs text-muted-foreground [&_th]:border-b">
        <tr>
          {sorting && <th className="px-3 py-3">拖动排序</th>}
          {materialColumns.map(([, label]) => (
            <th key={label} className="whitespace-nowrap px-4 py-3 font-medium">
              {label}
            </th>
          ))}
          <th className="sticky right-0 z-30 bg-muted px-4 py-3">操作</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr
            key={row.id}
            data-material-id={row.id}
            className="border-b last:border-0 hover:bg-muted/30"
            onDragOver={(e) => {
              if (sorting && !busy && dragging.current !== null)
                e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (sorting && !busy && dragging.current !== null)
                onMove(dragging.current, row.id);
              dragging.current = null;
            }}
          >
            {sorting && (
              <td className="min-w-28 px-3">
                <div className="flex items-center">
                  <button
                    aria-label={`拖动素材 ${row.id}`}
                    disabled={busy}
                    draggable={!busy}
                    className="cursor-grab p-2"
                    style={{ touchAction: "none" }}
                    onPointerDown={(e) => {
                      if (busy || e.button !== 0) return;
                      pointer.current = {
                        id: row.id,
                        x: e.clientX,
                        y: e.clientY,
                      };
                      e.currentTarget.setPointerCapture?.(e.pointerId);
                    }}
                    onPointerCancel={() => {
                      pointer.current = null;
                    }}
                    onPointerUp={(e) => {
                      const source = pointer.current;
                      pointer.current = null;
                      if (
                        !source ||
                        busy ||
                        Math.hypot(e.clientX - source.x, e.clientY - source.y) <
                          6
                      )
                        return;
                      // 部分 WebView 输入路径不启动 HTML5 拖放，使用实际落点补齐。
                      const target = document
                        .elementFromPoint(e.clientX, e.clientY)
                        ?.closest<HTMLElement>("tr[data-material-id]");
                      if (target?.dataset.materialId)
                        onMove(source.id, Number(target.dataset.materialId));
                    }}
                    onDragStart={(e) => {
                      pointer.current = null;
                      dragging.current = row.id;
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", String(row.id));
                    }}
                    onDragEnd={() => {
                      dragging.current = null;
                    }}
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
              </td>
            )}
            {materialColumns.map(([field]) => (
              <td
                key={field}
                className={`px-4 py-3 ${["titlePic", "titlePic2"].includes(field) ? "min-w-40" : ""}`}
              >
                {field === "titlePic" || field === "titlePic2" ? (
                  <MaterialImage
                    url={row[field]}
                    compact
                    label={field === "titlePic" ? "主图" : "第二张图片"}
                    onPreview={() => onDetail(row)}
                  />
                ) : field === "articleId" && articleUrl(row.articleId) ? (
                  <button
                    role="link"
                    className="text-primary hover:underline"
                    onClick={() => void open(articleUrl(row.articleId)!)}
                  >
                    {row.articleId}
                  </button>
                ) : field === "title" ? (
                  <button
                    className="min-w-56 max-w-80 text-left font-medium hover:underline"
                    onClick={() => onDetail(row)}
                  >
                    {show(row.title)}
                  </button>
                ) : field === "url" || field === "landUrl" ? (
                  <div className="flex w-56 items-center gap-1">
                    <button
                      role="link"
                      className="truncate text-primary hover:underline"
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
                ) : field === "smallText" ? (
                  <p
                    className="line-clamp-3 w-60"
                    title={row.smallText ?? undefined}
                  >
                    {show(row.smallText)}
                  </p>
                ) : (
                  <span
                    className={
                      field === "subChannel"
                        ? "block min-w-44"
                        : "whitespace-nowrap"
                    }
                  >
                    {show(
                      sorting && field === "order" ? index + 1 : row[field],
                    )}
                  </span>
                )}
              </td>
            ))}
            <td className="sticky right-0 z-10 min-w-44 bg-card px-2">
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
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
