import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareImageUpload } from "@/features/channels/upload";
let fail = false;
beforeEach(() => {
  fail = false;
  URL.createObjectURL = vi.fn(() => "blob:local");
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 640;
      naturalHeight = 360;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) {
        queueMicrotask(() => (fail ? this.onerror?.() : this.onload?.()));
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
it("实际解码后编码上传，只读取一次文件并释放临时 URL", async () => {
  const file = new File([new Uint8Array([1, 2, 3])], "a.png", {
    type: "image/png",
  });
  expect(await prepareImageUpload(file)).toEqual({
    fileName: "a.png",
    mimeType: "image/png",
    dataBase64: "AQID",
  });
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local");
});
it("空文件、超限及非图片不进入解码；解码失败也释放 URL", async () => {
  for (const file of [
    new File([], "empty.png", { type: "image/png" }),
    new File(["x"], "x.html", { type: "text/html" }),
  ])
    await expect(prepareImageUpload(file)).rejects.toThrow("20 MiB");
  const huge = new File(["x"], "huge.png", { type: "image/png" });
  Object.defineProperty(huge, "size", { value: 20 * 1024 * 1024 + 1 });
  await expect(prepareImageUpload(huge)).rejects.toThrow("20 MiB");
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  fail = true;
  await expect(
    prepareImageUpload(new File(["bad"], "bad.png", { type: "image/png" })),
  ).rejects.toThrow("图片无法解码");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local");
});
