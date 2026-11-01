"use client";

import * as React from "react";
import { cn } from "cn";
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";

type ScrollAreaProps = React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  orientation?: "vertical" | "horizontal" | "both";
  viewportRef?: React.Ref<HTMLDivElement>;
  viewportProps?: Omit<
    React.ComponentProps<typeof ScrollAreaPrimitive.Viewport>,
    "children" | "ref" | "asChild" | "disableImplicitContentElement"
  >;
};

function ScrollArea({
  className,
  children,
  orientation = "vertical",
  viewportRef,
  viewportProps,
  ...props
}: ScrollAreaProps) {
  const { className: viewportClassName, ...restViewportProps } =
    viewportProps ?? {};
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn(
        "relative grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        {...restViewportProps}
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className={cn(
          "size-full min-h-0 min-w-0 rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-1 focus-visible:-outline-offset-1",
          viewportClassName,
        )}
        disableImplicitContentElement
      >
        {/* 块布局允许普通内容换行，宽表格仍由视口承接溢出。 */}
        <ScrollAreaPrimitive.Content
          data-slot="scroll-area-content"
          className="min-h-full"
          style={{ display: "flow-root" }}
        >
          {children}
        </ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      {orientation !== "horizontal" && <ScrollBar />}
      {orientation !== "vertical" && <ScrollBar orientation="horizontal" />}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/scrollbar flex touch-none bg-transparent p-px select-none data-horizontal:h-2 data-horizontal:flex-col data-vertical:h-full data-vertical:w-2",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-[var(--scrollbar-thumb)] transition-colors group-hover/scrollbar:bg-[var(--scrollbar-thumb-hover)] group-active/scrollbar:bg-[var(--scrollbar-thumb-active)]"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar };
