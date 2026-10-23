import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PromoteImageCache, promoteImages } from "@/features/channels/images";
import { MaterialImage } from "@/features/channels/MaterialImage";
import { cmsIpc } from "@/services/tauri/cms";
import { invalidateClientRequests } from "@/services/tauri/client";
import { deferred } from "./cms-fixtures";
import type { PromoteImagePayload } from "@/types/cms";

vi.mock("@/services/tauri/cms", () => ({ cmsIpc: { image: vi.fn() } }));
const payload = {
  mimeType: "image/png",
  byteSize: 5,
  dataBase64: btoa("image"),
};
const dimensions = vi.fn(async () => ({ width: 280, height: 124 }));
beforeEach(() => {
  promoteImages.clear();
  vi.clearAllMocks();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => `blob:${Math.random()}`),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

describe("图片缓存和资源生命周期", () => {
  it("重复 URL 合并下载与解码，释放最后一个引用才撤销预览 URL", async () => {
    const load = vi.fn(async () => payload);
    const cache = new PromoteImageCache(load, dimensions);
    const [first, second] = await Promise.all([
      cache.acquire("https://test/a"),
      cache.acquire("https://test/a"),
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(dimensions).toHaveBeenCalledTimes(1);
    expect(first.src).toBe(second.src);
    expect(first).toMatchObject({ byteSize: 5, width: 280, height: 124 });
    first.release();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    second.release();
    second.release();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    const cached = await cache.acquire("https://test/a");
    expect(load).toHaveBeenCalledTimes(1);
    cached.release();
    cache.clear();
  });

  it("最多四个并发，排队请求共享结果", async () => {
    const pending = Array.from({ length: 6 }, () =>
      deferred<PromoteImagePayload>(),
    );
    const load = vi.fn(
      (_url: string) => pending[load.mock.calls.length - 1].promise,
    );
    const cache = new PromoteImageCache(load, dimensions);
    const tasks = Array.from({ length: 6 }, (_, i) =>
      cache.acquire(`https://test/${i}`),
    );
    expect(load).toHaveBeenCalledTimes(4);
    pending[0].resolve(payload);
    const first = await tasks[0];
    first.release();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(5));
    pending[1].resolve(payload);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(6));
    pending.slice(2).forEach((task) => task.resolve(payload));
    (await Promise.all(tasks)).forEach((image) => image.release());
    cache.clear();
  });

  it("按实际字节 LRU 淘汰，退出清理活动 URL 与旧响应", async () => {
    const load = vi.fn(async () => payload);
    const cache = new PromoteImageCache(load, dimensions, 10);
    for (const name of ["a", "b", "a", "c", "b"])
      (await cache.acquire(`https://test/${name}`)).release();
    expect(load).toHaveBeenCalledTimes(4);
    const active = await cache.acquire("https://test/b");
    cache.clear();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(active.src);
    const old = deferred<PromoteImagePayload>();
    load.mockReturnValueOnce(old.promise);
    const stale = cache.acquire("https://test/old");
    const rejection = expect(stale).rejects.toMatchObject({
      code: "SESSION_CHANGED",
    });
    cache.clear();
    await rejection;
    old.resolve(payload);
    await Promise.resolve();
    const fresh = await cache.acquire("https://test/old");
    expect(load).toHaveBeenCalledTimes(6);
    fresh.release();
    cache.clear();
  });

  it("完整性、解码和超限失败不进入缓存，可单图重试", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ ...payload, byteSize: 6 })
      .mockResolvedValueOnce({ ...payload, byteSize: 21 * 1024 * 1024 })
      .mockResolvedValue(payload);
    const decode = vi
      .fn()
      .mockRejectedValueOnce(new Error("图片无法解码"))
      .mockResolvedValue({ width: 1, height: 2 });
    const cache = new PromoteImageCache(load, decode);
    await expect(cache.acquire("https://test/a")).rejects.toThrow("不完整");
    await expect(cache.acquire("https://test/a")).rejects.toThrow();
    await expect(cache.acquire("https://test/a")).rejects.toThrow("无法解码");
    (await cache.acquire("https://test/a")).release();
    expect(load).toHaveBeenCalledTimes(4);
    cache.clear();
  });
});

describe("共用图片组件", () => {
  it("空图片不请求，失败可重试，使用解码尺寸和真实大小", async () => {
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 281;
        naturalHeight = 125;
        onload?: () => void;
        onerror?: () => void;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    vi.mocked(cmsIpc.image)
      .mockRejectedValueOnce(new Error("图片超过 20 MiB 限制"))
      .mockResolvedValue(payload);
    const view = render(
      <>
        <MaterialImage url={null} />
        <MaterialImage url="https://test/a" label="主图" compact />
      </>,
    );
    expect(screen.getByText("暂无图片")).toBeInTheDocument();
    expect(await screen.findByText("图片超过 20 MiB 限制")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试主图" }));
    expect(await screen.findByText("281 × 125 px")).toBeInTheDocument();
    expect(screen.getByText("5 B")).toBeInTheDocument();
    expect(cmsIpc.image).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      expect.stringContaining("blob:"),
    );
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2); // 解码 URL 和最后一个预览引用。
    vi.unstubAllGlobals();
  });

  it("接近可视区域才加载，会话变化丢弃旧结果", async () => {
    let intersect!: IntersectionObserverCallback;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersect = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const first = deferred<PromoteImagePayload>();
    vi.mocked(cmsIpc.image).mockReturnValue(first.promise);
    const view = render(<MaterialImage url="https://test/old" />);
    expect(cmsIpc.image).not.toHaveBeenCalled();
    await act(async () =>
      intersect(
        [{ isIntersecting: true }] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      ),
    );
    expect(cmsIpc.image).toHaveBeenCalledOnce();
    await act(async () => invalidateClientRequests());
    await act(async () => first.resolve(payload));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    view.unmount();
    vi.unstubAllGlobals();
  });

  it("切换图片地址后旧响应不会覆盖新图，并释放迟到的引用", async () => {
    const old = deferred<Awaited<ReturnType<typeof promoteImages.acquire>>>();
    const releaseOld = vi.fn();
    const releaseNew = vi.fn();
    const acquire = vi
      .spyOn(promoteImages, "acquire")
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue({
        src: "blob:new",
        byteSize: 100,
        width: 20,
        height: 10,
        release: releaseNew,
      });
    const view = render(<MaterialImage url="https://test/old" />);
    view.rerender(<MaterialImage url="https://test/new" />);
    expect(await screen.findByRole("img")).toHaveAttribute("src", "blob:new");
    await act(async () =>
      old.resolve({
        src: "blob:old",
        byteSize: 50,
        width: 5,
        height: 5,
        release: releaseOld,
      }),
    );
    expect(screen.getByRole("img")).toHaveAttribute("src", "blob:new");
    expect(releaseOld).toHaveBeenCalledOnce();
    view.unmount();
    expect(releaseNew).toHaveBeenCalledOnce();
    acquire.mockRestore();
  });
});
