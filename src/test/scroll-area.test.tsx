import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ScrollArea } from "@/components/ui/scroll-area";

it("根节点引用与滚动视口独立，视口支持命名、焦点和滚动事件", () => {
  const root = createRef<HTMLDivElement>();
  const viewport = createRef<HTMLDivElement>();
  const onScroll = vi.fn();
  const view = render(
    <ScrollArea
      ref={root}
      viewportRef={viewport}
      orientation="both"
      viewportProps={{
        role: "region",
        "aria-label": "演示滚动区",
        tabIndex: 0,
        onScroll,
      }}
    >
      演示内容
    </ScrollArea>,
  );
  expect(viewport.current).toBe(
    screen.getByRole("region", { name: "演示滚动区" }),
  );
  expect(root.current).not.toBe(viewport.current);
  viewport.current!.focus();
  expect(viewport.current).toHaveFocus();
  viewport.current!.scrollTop = 120;
  viewport.current!.scrollLeft = 80;
  fireEvent.scroll(viewport.current!);
  expect(onScroll).toHaveBeenCalledOnce();
  expect(onScroll.mock.calls[0][0].target).toBe(viewport.current);
  expect(root.current!.scrollTop).toBe(0);
  expect(root.current!.scrollLeft).toBe(0);
  view.unmount();
  expect(root.current).toBeNull();
  expect(viewport.current).toBeNull();
});
