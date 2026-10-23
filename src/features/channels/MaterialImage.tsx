import { useEffect, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import { promoteImages, imageByteSize, type ImageLease } from "./images";

export function MaterialImage({
  url,
  compact = false,
  onPreview,
  label = "素材图片",
}: {
  url: string | null;
  compact?: boolean;
  onPreview?: () => void;
  label?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    url: string;
    image?: ImageLease;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!globalThis.IntersectionObserver) {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!near || !url) return;
    let active = true;
    let lease: ImageLease | undefined;
    setResult(null);
    void promoteImages
      .acquire(url)
      .then((image) => {
        if (!active) {
          image.release();
          return;
        }
        lease = image;
        setResult({ url, image });
      })
      .catch((error: unknown) => {
        if (active)
          setResult({
            url,
            error: error instanceof Error ? error.message : "图片加载失败",
          });
      });
    return () => {
      active = false;
      lease?.release();
    };
  }, [url, near, retry]);
  const current = result?.url === url ? result : null;
  const image = current?.image;
  const frame = compact ? "h-20 w-32" : "h-64 w-full";
  return (
    <div ref={container} className={compact ? "w-32 shrink-0" : "min-w-0"}>
      {image ? (
        <button
          type="button"
          disabled={!onPreview}
          aria-label={`预览${label}`}
          onClick={onPreview}
          className={`${frame} block overflow-hidden rounded-md border bg-muted/30 disabled:cursor-default`}
        >
          <img
            src={image.src}
            alt={label}
            className="size-full object-contain"
            onError={() => {
              image.release();
              setResult({ url: url!, error: "图片无法预览，请重试" });
            }}
          />
        </button>
      ) : (
        <div
          className={`${frame} flex flex-col items-center justify-center gap-1 rounded-md border bg-muted/30 px-1 text-center text-xs text-muted-foreground`}
        >
          <ImageOff className="size-4 shrink-0" />
          <span>
            {!url
              ? "暂无图片"
              : (current?.error ?? (near ? "正在加载图片…" : "等待加载图片"))}
          </span>
          {url && current?.error && (
            <button
              type="button"
              className="underline"
              aria-label={`重试${label}`}
              onClick={() => setRetry((value) => value + 1)}
            >
              重试
            </button>
          )}
        </div>
      )}
      {image && (
        <div className="mt-1 space-y-0.5 text-xs leading-4 text-muted-foreground">
          <p>{imageByteSize(image.byteSize)}</p>
          <p>
            {image.width} × {image.height} px
          </p>
        </div>
      )}
    </div>
  );
}
