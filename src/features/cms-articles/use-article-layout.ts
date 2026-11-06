import { useLayoutEffect, useRef, useState } from "react";

/** 以记录区宽度适配侧栏展开、收起；不改变 Android 独立页面。 */
export function useArticleLayout() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const next = element.getBoundingClientRect().width;
      if (next > 0) setWidth(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return {
    ref,
    layout: width < 640 ? "cards" : width < 960 ? "compact" : "wide",
  } as const;
}
