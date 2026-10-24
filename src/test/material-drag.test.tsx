import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MaterialTable } from "@/features/channels/MaterialTable";
import { materialColumnPreferences } from "@/features/channels/table-model";
import { useColumnPreferences } from "@/hooks/use-column-preferences";
import { material } from "./cms-fixtures";

vi.mock("@/features/channels/MaterialImage", () => ({
  MaterialImage: ({ label }: { label: string }) => <span>{label}</span>,
}));

const rows = [material(1), material(2)];
const onMove = vi.fn();
function TestTable({
  sorting = true,
  busy = false,
  records = rows,
}: {
  sorting?: boolean;
  busy?: boolean;
  records?: typeof rows;
}) {
  const preferences = useColumnPreferences(
    "channels",
    materialColumnPreferences,
  );
  return (
    <MaterialTable
      rows={records}
      sorting={sorting}
      busy={busy}
      preferences={preferences}
      onMove={onMove}
      onDetail={() => undefined}
      onEdit={() => undefined}
      onDelete={() => undefined}
    />
  );
}

function pointer(
  handle: HTMLElement,
  type: string,
  x: number,
  y: number,
  pointerId = 1,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  fireEvent(handle, event);
}

const originalHitTest = Object.getOwnPropertyDescriptor(
  document,
  "elementFromPoint",
);
function hitTest(target: Element | null) {
  const hit = vi.fn(() => target);
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: hit,
  });
  return hit;
}
afterEach(() => {
  onMove.mockClear();
  if (originalHitTest)
    Object.defineProperty(document, "elementFromPoint", originalHitTest);
  else Reflect.deleteProperty(document, "elementFromPoint");
});

function begin() {
  const handle = screen.getByLabelText("拖动素材 2");
  const row = handle.closest("tr")!;
  pointer(handle, "pointerdown", 35, 180);
  return { handle, row };
}

describe("渠道素材整行拖动", () => {
  it("原生拖动影像使用整行及按下偏移，接管后不重复触发指针移动", () => {
    render(<TestTable />);
    const { handle, row } = begin();
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 150,
    } as DOMRect);
    pointer(handle, "pointermove", 35, 200);
    expect(row.style.transform).toBe("translateY(20px)");
    const dataTransfer = {
      setDragImage: vi.fn(),
      setData: vi.fn(),
      effectAllowed: "",
      dropEffect: "",
    };
    fireEvent.dragStart(handle, { dataTransfer });
    expect(dataTransfer.setDragImage).toHaveBeenCalledWith(row, 25, 30);
    expect(dataTransfer.effectAllowed).toBe("move");
    expect(row.style.transform).toBe("");
    expect(row).not.toHaveAttribute("data-material-dragging");
    const target = screen.getByLabelText("拖动素材 1").closest("tr")!;
    hitTest(target);
    pointer(handle, "pointercancel", 35, 200);
    pointer(handle, "lostpointercapture", 35, 200);
    pointer(handle, "pointerup", 35, 60);
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.dragOver(target, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("move");
    fireEvent.drop(target, { dataTransfer });
    fireEvent.dragEnd(handle);
    expect(onMove).toHaveBeenCalledExactlyOnceWith(2, 1);
    fireEvent.drop(target, { dataTransfer });
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it("轻点不移动，超过阈值整行跟随，松手命中时移动且恢复样式和捕获", () => {
    render(<TestTable />);
    const target = screen.getByLabelText("拖动素材 1").closest("tr")!;
    const hit = hitTest(target);
    const { handle, row } = begin();
    Object.defineProperty(handle, "hasPointerCapture", {
      value: () => true,
    });
    const release = vi.fn();
    Object.defineProperty(handle, "releasePointerCapture", { value: release });
    pointer(handle, "pointermove", 35, 184);
    expect(row.style.transform).toBe("");
    pointer(handle, "pointerup", 35, 184);
    expect(onMove).not.toHaveBeenCalled();
    expect(hit).not.toHaveBeenCalled();
    pointer(handle, "pointerdown", 35, 180);
    pointer(handle, "pointermove", 40, 80);
    expect(row.style.transform).toBe("translateY(-100px)");
    expect(row).toHaveAttribute("data-material-dragging", "true");
    expect(row).toHaveTextContent("渠道新闻 2");
    expect(onMove).not.toHaveBeenCalled();
    hit.mockImplementation(() => {
      expect(row.style.pointerEvents).toBe("none");
      return target;
    });
    pointer(handle, "pointerup", 40, 80);
    expect(onMove).toHaveBeenCalledExactlyOnceWith(2, 1);
    expect(row.style.transform).toBe("");
    expect(row).not.toHaveAttribute("data-material-dragging");
    expect(row.style.pointerEvents).toBe("");
    expect(release).toHaveBeenLastCalledWith(1);
  });

  it.each(["pointercancel", "lostpointercapture"])(
    "%s 清理整行预览且不调整顺序",
    (type) => {
      render(<TestTable />);
      const { handle, row } = begin();
      pointer(handle, "pointermove", 35, 80);
      pointer(handle, type, 35, 80);
      pointer(handle, "pointerup", 35, 80);
      expect(row.style.transform).toBe("");
      expect(row).not.toHaveAttribute("data-material-dragging");
      expect(onMove).not.toHaveBeenCalled();
    },
  );

  it("其他指针不能移动或结束当前手势", () => {
    render(<TestTable />);
    hitTest(screen.getByLabelText("拖动素材 1").closest("tr"));
    const { handle, row } = begin();
    pointer(handle, "pointerdown", 35, 200, 2);
    pointer(handle, "pointermove", 35, 80, 2);
    pointer(handle, "pointerup", 35, 80, 2);
    pointer(handle, "pointercancel", 35, 80, 2);
    expect(row.style.transform).toBe("");
    expect(onMove).not.toHaveBeenCalled();
    pointer(handle, "pointermove", 35, 80);
    pointer(handle, "pointerup", 35, 80);
    expect(onMove).toHaveBeenCalledExactlyOnceWith(2, 1);
  });

  it.each(["outside", "foreign", "self"])(
    "落在无效位置 %s 时恢复原行且不排序",
    (location) => {
      render(<TestTable />);
      const { handle, row } = begin();
      const foreign = document.createElement("tr");
      foreign.dataset.materialId = "1";
      hitTest(
        location === "outside" ? null : location === "self" ? row : foreign,
      );
      pointer(handle, "pointermove", 35, 80);
      pointer(handle, "pointerup", 35, 80);
      expect(onMove).not.toHaveBeenCalled();
      expect(row.style.transform).toBe("");
      expect(row).not.toHaveAttribute("data-material-dragging");
    },
  );

  it.each(["busy", "sorting", "records", "unmount"])(
    "%s 变化时清理拖动状态",
    (change) => {
      const view = render(<TestTable />);
      const { handle, row } = begin();
      pointer(handle, "pointermove", 35, 80);
      if (change === "unmount") view.unmount();
      else
        view.rerender(
          <TestTable
            busy={change === "busy"}
            sorting={change !== "sorting"}
            records={change === "records" ? [...rows] : rows}
          />,
        );
      expect(row.style.transform).toBe("");
      expect(row).not.toHaveAttribute("data-material-dragging");
      pointer(handle, "pointerup", 35, 80);
      expect(onMove).not.toHaveBeenCalled();
    },
  );

  it("取消原生拖动后不接受迟到的放下事件", () => {
    render(<TestTable />);
    const { handle } = begin();
    fireEvent.dragStart(handle, {
      dataTransfer: { setDragImage: vi.fn(), setData: vi.fn() },
    });
    fireEvent.dragEnd(handle);
    fireEvent.drop(screen.getByLabelText("拖动素材 1").closest("tr")!);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("进入保存状态后禁用手柄并拒绝尚未完成的原生放下事件", () => {
    const view = render(<TestTable />);
    const { handle } = begin();
    fireEvent.dragStart(handle, {
      dataTransfer: { setDragImage: vi.fn(), setData: vi.fn() },
    });
    view.rerender(<TestTable busy />);
    expect(handle).toBeDisabled();
    expect(handle).toHaveAttribute("draggable", "false");
    fireEvent.drop(screen.getByLabelText("拖动素材 1").closest("tr")!);
    expect(onMove).not.toHaveBeenCalled();
  });
});
