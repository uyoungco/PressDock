import { cmsIpc } from "@/services/tauri/cms";
import { onClientInvalidated, ServiceError } from "@/services/tauri/client";
import { promoteImageSchema, type PromoteImagePayload } from "@/types/cms";

type Dimensions = { width: number; height: number };
type Entry = Dimensions & {
  blob: Blob;
  byteSize: number;
  refs: number;
  url: string | null;
};
export type ImageLease = Dimensions & {
  src: string;
  byteSize: number;
  release: () => void;
};
type Job = {
  controller: AbortController;
  run: () => Promise<void>;
  reject: (reason: Error) => void;
};
const changed = () =>
  new ServiceError("SESSION_CHANGED", "登录状态已变化，请重试");

async function decode(blob: Blob, signal: AbortSignal): Promise<Dimensions> {
  const src = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      const abort = () => {
        cleanup();
        reject(changed());
      };
      const cleanup = () => {
        image.onload = null;
        image.onerror = null;
        signal.removeEventListener("abort", abort);
      };
      image.onload = () => {
        cleanup();
        if (image.naturalWidth > 0 && image.naturalHeight > 0)
          resolve({ width: image.naturalWidth, height: image.naturalHeight });
        else reject(new Error("图片无法解码"));
      };
      image.onerror = () => {
        cleanup();
        reject(new Error("图片无法解码"));
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      image.src = src;
    });
  } finally {
    URL.revokeObjectURL(src);
  }
}

export class PromoteImageCache {
  private epoch = 0;
  private active = 0;
  private bytes = 0;
  private cache = new Map<string, Entry>();
  private live = new Set<Entry>();
  private pending = new Map<string, Promise<Entry>>();
  private jobs = new Set<Job>();
  private queue: Job[] = [];

  constructor(
    private readonly load: (url: string) => Promise<PromoteImagePayload>,
    private readonly dimensions = decode,
    private readonly limit = 64 * 1024 * 1024,
  ) {}

  clear() {
    this.epoch += 1;
    for (const job of this.jobs) {
      job.controller.abort();
      job.reject(changed());
    }
    this.jobs.clear();
    this.queue = [];
    this.pending.clear();
    this.cache.clear();
    this.bytes = 0;
    for (const entry of this.live) {
      if (entry.url) URL.revokeObjectURL(entry.url);
      entry.url = null;
    }
    this.live.clear();
  }

  private pump() {
    while (this.active < 4 && this.queue.length) {
      const job = this.queue.shift()!;
      this.active += 1;
      void job.run().finally(() => {
        this.active -= 1;
        this.jobs.delete(job);
        this.pump();
      });
    }
  }

  private get(url: string): Promise<Entry> {
    const cached = this.cache.get(url);
    if (cached) {
      this.cache.delete(url);
      this.cache.set(url, cached);
      return Promise.resolve(cached);
    }
    const existing = this.pending.get(url);
    if (existing) return existing;
    const epoch = this.epoch;
    const task = new Promise<Entry>((resolve, reject) => {
      const job: Job = {
        controller: new AbortController(),
        reject,
        run: async () => {
          try {
            if (epoch !== this.epoch) throw changed();
            const payload = promoteImageSchema.parse(await this.load(url));
            if (epoch !== this.epoch) throw changed();
            const raw = atob(payload.dataBase64);
            if (raw.length !== payload.byteSize)
              throw new Error("图片数据不完整，请重试");
            const bytes = Uint8Array.from(raw, (character) =>
              character.charCodeAt(0),
            );
            const blob = new Blob([bytes], { type: payload.mimeType });
            const size = await this.dimensions(blob, job.controller.signal);
            if (epoch !== this.epoch) throw changed();
            const entry: Entry = {
              ...size,
              blob,
              byteSize: blob.size,
              refs: 0,
              url: null,
            };
            if (entry.byteSize <= this.limit) {
              this.cache.set(url, entry);
              this.bytes += entry.byteSize;
              while (this.bytes > this.limit) {
                const first = this.cache.keys().next().value!;
                this.bytes -= this.cache.get(first)!.byteSize;
                this.cache.delete(first);
              }
            }
            resolve(entry);
          } catch (error) {
            reject(
              error instanceof Error
                ? error
                : new Error("图片加载失败，请重试"),
            );
          }
        },
      };
      this.jobs.add(job);
      this.queue.push(job);
    });
    this.pending.set(url, task);
    void task.then(
      () => {
        if (this.pending.get(url) === task) this.pending.delete(url);
      },
      () => {
        if (this.pending.get(url) === task) this.pending.delete(url);
      },
    );
    this.pump();
    return task;
  }

  async acquire(url: string): Promise<ImageLease> {
    const epoch = this.epoch;
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      throw new Error("仅支持 HTTPS 图片");
    const entry = await this.get(url);
    if (epoch !== this.epoch) throw changed();
    if (!entry.url) entry.url = URL.createObjectURL(entry.blob);
    entry.refs += 1;
    this.live.add(entry);
    let released = false;
    return {
      src: entry.url,
      byteSize: entry.byteSize,
      width: entry.width,
      height: entry.height,
      release: () => {
        if (released) return;
        released = true;
        entry.refs -= 1;
        if (!entry.refs) {
          if (entry.url) URL.revokeObjectURL(entry.url);
          entry.url = null;
          this.live.delete(entry);
        }
      },
    };
  }
}

export const promoteImages = new PromoteImageCache((url) => cmsIpc.image(url));
onClientInvalidated(() => promoteImages.clear());

export function imageByteSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
