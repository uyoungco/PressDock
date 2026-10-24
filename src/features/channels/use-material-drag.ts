import { useCallback, useEffect, useRef } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes } from "react";

interface DragSource {
  id: number;
  element: HTMLTableRowElement;
  handle: HTMLButtonElement;
  transform: string;
}
interface PointerDrag extends DragSource {
  mode: "pointer";
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
}
type Drag = PointerDrag | (DragSource & { mode: "native" });

function source(handle: HTMLButtonElement, id: number): DragSource | null {
  const element = handle.closest<HTMLTableRowElement>("tr[data-material-id]");
  return element
    ? { id, element, handle, transform: element.style.transform }
    : null;
}

function movePreview(drag: PointerDrag, x: number, y: number) {
  if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) < 6) return;
  drag.moved = true;
  // 移动原行，保留表格占位、列宽、固定列及已加载的图片。
  drag.element.dataset.materialDragging = "true";
  drag.element.style.transform = `translateY(${y - drag.y}px)`;
}

export function useMaterialDrag({
  rows,
  sorting,
  busy,
  onMove,
}: {
  rows: { id: number }[];
  sorting: boolean;
  busy: boolean;
  onMove: (from: number, to: number) => void;
}) {
  const current = useRef<Drag | null>(null);
  const enabled = sorting && !busy;
  const reset = useCallback(() => {
    const drag = current.current;
    current.current = null;
    if (!drag) return;
    drag.element.style.transform = drag.transform;
    delete drag.element.dataset.materialDragging;
    if (
      drag.mode === "pointer" &&
      drag.handle.hasPointerCapture?.(drag.pointerId)
    )
      drag.handle.releasePointerCapture(drag.pointerId);
  }, []);

  // 保存、退出排序、数据替换和卸载均结束尚未完成的手势。
  useEffect(() => reset, [rows, sorting, busy, reset]);

  function getHandleProps(id: number): ButtonHTMLAttributes<HTMLButtonElement> {
    return {
      disabled: !enabled,
      draggable: enabled,
      style: { touchAction: "none" },
      onPointerDown: (event) => {
        if (
          !enabled ||
          event.button !== 0 ||
          event.isPrimary === false ||
          current.current
        )
          return;
        const row = source(event.currentTarget, id);
        if (!row) return;
        current.current = {
          ...row,
          mode: "pointer",
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          moved: false,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      },
      onPointerMove: (event) => {
        const drag = current.current;
        if (
          !enabled ||
          drag?.mode !== "pointer" ||
          drag.pointerId !== event.pointerId
        )
          return;
        movePreview(drag, event.clientX, event.clientY);
      },
      onPointerUp: (event) => {
        const drag = current.current;
        if (drag?.mode !== "pointer" || drag.pointerId !== event.pointerId)
          return;
        let targetId: number | undefined;
        if (enabled) {
          movePreview(drag, event.clientX, event.clientY);
          if (drag.moved) {
            // 仅命中测试时穿透移动行，避免提前阻断浏览器启动原生拖放。
            const previous = drag.element.style.pointerEvents;
            drag.element.style.pointerEvents = "none";
            let target: HTMLTableRowElement | null | undefined;
            try {
              target = document
                .elementFromPoint(event.clientX, event.clientY)
                ?.closest<HTMLTableRowElement>("tr[data-material-id]");
            } finally {
              drag.element.style.pointerEvents = previous;
            }
            if (
              target &&
              target !== drag.element &&
              drag.element.isConnected &&
              target.parentElement === drag.element.parentElement
            )
              targetId = Number(target.dataset.materialId);
          }
        }
        reset();
        if (targetId !== undefined && rows.some((row) => row.id === targetId))
          onMove(drag.id, targetId);
      },
      onPointerCancel: (event) => {
        const drag = current.current;
        if (drag?.mode === "pointer" && drag.pointerId === event.pointerId)
          reset();
      },
      onLostPointerCapture: (event) => {
        const drag = current.current;
        if (drag?.mode === "pointer" && drag.pointerId === event.pointerId)
          reset();
      },
      onDragStart: (event) => {
        if (!enabled) {
          event.preventDefault();
          reset();
          return;
        }
        const previous = current.current;
        const x = previous?.mode === "pointer" ? previous.x : event.clientX;
        const y = previous?.mode === "pointer" ? previous.y : event.clientY;
        reset();
        const row = source(event.currentTarget, id);
        if (!row) {
          event.preventDefault();
          return;
        }
        const rect = row.element.getBoundingClientRect();
        event.dataTransfer.setDragImage(
          row.element,
          x - rect.left,
          y - rect.top,
        );
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(id));
        current.current = { ...row, mode: "native" };
      },
      onDragEnd: () => {
        if (current.current?.mode === "native" && current.current.id === id)
          reset();
      },
    };
  }

  function getRowProps(id: number): HTMLAttributes<HTMLTableRowElement> & {
    "data-material-id": number;
  } {
    return {
      "data-material-id": id,
      className:
        "data-[material-dragging]:relative data-[material-dragging]:z-15 data-[material-dragging]:cursor-grabbing data-[material-dragging]:bg-card data-[material-dragging]:shadow-lg data-[material-dragging]:select-none",
      onDragOver: (event) => {
        if (enabled && current.current?.mode === "native") {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      },
      onDrop: (event) => {
        const drag = current.current;
        if (drag?.mode !== "native") return;
        event.preventDefault();
        const valid =
          enabled &&
          drag.element.isConnected &&
          event.currentTarget.parentElement === drag.element.parentElement;
        reset();
        if (valid && drag.id !== id) onMove(drag.id, id);
      },
    };
  }

  return { getHandleProps, getRowProps };
}
