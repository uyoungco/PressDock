import { useLayoutEffect, useRef, useState } from "react";

export function useImportLayout(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);
  useLayoutEffect(() => {
    if (!enabled || !ref.current) return;
    const element = ref.current;
    const measure = () => {
      const next = element.getBoundingClientRect().width;
      if (next > 0) setWidth(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled]);
  return {
    ref,
    layout: width < 640 ? "cards" : width < 960 ? "compact" : "wide",
  } as const;
}
