import { imagesIpc } from "@/services/tauri/images";
import { onClientInvalidated, ServiceError } from "@/services/tauri/client";
import {
  IMAGE_MIMES,
  MAX_IMAGE_SIZE,
  imageFileName,
  imagePresetSchema,
  type ImageProcessOptions,
  type ImageProcessorPreset,
  type ImageProcessorResult,
} from "./model";

const active = new Map<string, AbortController>();
const aborted = () => new ServiceError("IMAGE_CANCELLED", "图片处理已取消");
onClientInvalidated(() => {
  for (const controller of active.values()) controller.abort();
});

export function blobFromBase64(data: string, type: string) {
  const raw = atob(data);
  return new Blob([Uint8Array.from(raw, (value) => value.charCodeAt(0))], {
    type,
  });
}
function read(image: Blob, signal: AbortSignal): Promise<string> {
  if (!image.size || image.size > MAX_IMAGE_SIZE)
    return Promise.reject(
      new Error("请选择不超过 20 MiB 的静态 JPG、PNG 或 WebP 图片"),
    );
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const stop = () => reader.abort();
    const cleanup = () => {
      signal.removeEventListener("abort", stop);
      reader.onload = reader.onerror = reader.onabort = null;
    };
    signal.addEventListener("abort", stop, { once: true });
    reader.onload = () => {
      const data = String(reader.result).split(",")[1];
      cleanup();
      resolve(data);
    };
    reader.onerror = () => {
      cleanup();
      reject(new Error("读取图片失败"));
    };
    reader.onabort = () => {
      cleanup();
      reject(aborted());
    };
    reader.readAsDataURL(image);
  });
}
async function operation<T>(
  signal: AbortSignal | undefined,
  run: (id: string, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const id = crypto.randomUUID();
  const controller = new AbortController();
  const stop = () => controller.abort();
  const cancelNative = () => {
    void imagesIpc.cancel(id).catch(() => undefined);
  };
  signal?.addEventListener("abort", stop, { once: true });
  controller.signal.addEventListener("abort", cancelNative, { once: true });
  active.set(id, controller);
  try {
    if (signal?.aborted) controller.abort();
    if (controller.signal.aborted) throw aborted();
    const result = await run(id, controller.signal);
    if (controller.signal.aborted) throw aborted();
    return result;
  } finally {
    active.delete(id);
    signal?.removeEventListener("abort", stop);
    controller.signal.removeEventListener("abort", cancelNative);
  }
}
async function input(image: Blob, signal: AbortSignal) {
  const dataBase64 = await read(image, signal);
  if (signal.aborted) throw aborted();
  return { dataBase64, mimeType: image.type };
}
function optionsWithPreset(
  options: ImageProcessOptions,
  preset: ImageProcessorPreset,
) {
  const locked = imagePresetSchema.parse(preset);
  if (
    (locked.format && options.format !== locked.format) ||
    (locked.maxBytes !== undefined && options.maxBytes !== locked.maxBytes) ||
    (locked.size &&
      (options.size?.width !== locked.size.width ||
        options.size?.height !== locked.size.height))
  ) {
    throw new Error("处理参数与预设不一致，请重置后重试");
  }
  return options;
}
export const imageService = {
  inspect: (image: Blob, signal?: AbortSignal) =>
    operation(signal, async (id, current) => {
      const source = await input(image, current);
      return imagesIpc.inspect(id, source);
    }),
  process: (
    image: Blob,
    options: ImageProcessOptions,
    preset: ImageProcessorPreset = {},
    signal?: AbortSignal,
  ) => {
    optionsWithPreset(options, preset);
    return operation(signal, async (id, current) => {
      const source = await input(image, current);
      const output = await imagesIpc.process({
        ...options,
        jobId: id,
        input: source,
      });
      const blob = blobFromBase64(output.dataBase64, output.mimeType);
      if (
        output.mimeType !== IMAGE_MIMES[options.format] ||
        output.format !== options.format ||
        blob.size !== output.byteSize ||
        (options.maxBytes !== undefined && blob.size > options.maxBytes) ||
        (options.size &&
          (output.width !== options.size.width ||
            output.height !== options.size.height))
      ) {
        throw new Error("处理结果不符合尺寸、格式或体积要求");
      }
      const result: ImageProcessorResult = {
        file: new File([blob], imageFileName(image, output.format), {
          type: output.mimeType,
        }),
        width: output.width,
        height: output.height,
        format: output.format,
        byteSize: blob.size,
      };
      return { result, quality: output.quality, lossy: output.lossy };
    });
  },
  export: (result: ImageProcessorResult, signal?: AbortSignal) =>
    operation(signal, async (id, current) =>
      imagesIpc.export(
        id,
        await input(result.file, current),
        result.format,
        result.file.name,
      ),
    ),
};
