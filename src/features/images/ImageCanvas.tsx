import { useRef, useState, type ReactNode, type Ref } from "react";
import { cn } from "cn";

/** 放大后在固定画布内平移，裁剪坐标仍由图片本身的百分比决定。 */
export function ImageCanvas({
  viewportRef,
  width,
  height,
  bounds,
  viewKey,
  children,
}: {
  viewportRef: Ref<HTMLDivElement>;
  width: number;
  height: number;
  bounds: { width: number; height: number };
  viewKey: string;
  children: ReactNode;
}) {
  const [space, setSpace] = useState(false);
  const [entry, setEntry] = useState({ key: viewKey, x: 0, y: 0 });
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
  } | null>(null);
  const limitX = Math.max(0, (width - bounds.width + 48) / 2);
  const limitY = Math.max(0, (height - bounds.height + 48) / 2);
  const canPan = limitX > 0 || limitY > 0;
  const clampX = (value: number) => Math.max(-limitX, Math.min(limitX, value));
  const clampY = (value: number) => Math.max(-limitY, Math.min(limitY, value));
  const x = entry.key === viewKey ? clampX(entry.x) : 0;
  const y = entry.key === viewKey ? clampY(entry.y) : 0;
  return (
    <div
      ref={viewportRef}
      role="region"
      aria-label="图片裁剪工作区"
      tabIndex={0}
      title="放大后按住空格拖动画布，或聚焦画布后用方向键平移"
      className={cn(
        "image-dialog-canvas",
        space && canPan && "image-dialog-canvas-pan",
      )}
      onKeyDown={(event) => {
        if (event.code === "Space") {
          event.preventDefault();
          event.stopPropagation();
          setSpace(true);
        } else if (event.target === event.currentTarget && canPan) {
          const moves: Record<string, [number, number]> = {
            ArrowLeft: [24, 0],
            ArrowRight: [-24, 0],
            ArrowUp: [0, 24],
            ArrowDown: [0, -24],
          };
          const move = moves[event.key];
          if (move) {
            event.preventDefault();
            setEntry({
              key: viewKey,
              x: clampX(x + move[0]),
              y: clampY(y + move[1]),
            });
          }
        }
      }}
      onKeyUp={(event) => {
        if (event.code === "Space") {
          event.preventDefault();
          event.stopPropagation();
          setSpace(false);
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setSpace(false);
          drag.current = null;
        }
      }}
      onPointerDownCapture={(event) => {
        if ((space || event.button === 1) && canPan) {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            id: event.pointerId,
            x,
            y,
            startX: event.clientX,
            startY: event.clientY,
          };
        } else if (event.target === event.currentTarget)
          event.currentTarget.focus({ preventScroll: true });
      }}
      onPointerMoveCapture={(event) => {
        const start = drag.current;
        if (start?.id !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        setEntry({
          key: viewKey,
          x: clampX(start.x + event.clientX - start.startX),
          y: clampY(start.y + event.clientY - start.startY),
        });
      }}
      onPointerUpCapture={(event) => {
        if (drag.current?.id !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    >
      <div
        className="image-dialog-canvas-image"
        style={{
          width,
          height,
          transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
