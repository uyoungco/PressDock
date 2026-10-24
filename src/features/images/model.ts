import { z } from "zod";

export const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 24_000_000;
export const MAX_IMAGE_SIDE = 16_384;
export const imageFormatSchema = z.enum(["jpeg", "png", "webp"]);
export type ImageFormat = z.infer<typeof imageFormatSchema>;
export const imageSizeSchema = z
  .object({
    width: z.number().int().positive().max(MAX_IMAGE_SIDE),
    height: z.number().int().positive().max(MAX_IMAGE_SIDE),
  })
  .refine(
    (size) => size.width * size.height <= MAX_IMAGE_PIXELS,
    "图片总像素不能超过 2400 万",
  );
export const imagePresetSchema = z.object({
  maxBytes: z.number().int().positive().max(MAX_IMAGE_SIZE).optional(),
  size: imageSizeSchema.optional(),
  format: imageFormatSchema.optional(),
});
export type ImageProcessorPreset = z.infer<typeof imagePresetSchema>;
export interface ImageProcessorResult {
  file: File;
  width: number;
  height: number;
  format: ImageFormat;
  byteSize: number;
}
export interface ImageProcessorProps {
  image: File | Blob;
  preset?: ImageProcessorPreset;
  onConfirm: (result: ImageProcessorResult) => void;
  onCancel: () => void;
}
const base64Schema = z
  .string()
  .min(1)
  .max(4 * Math.ceil(MAX_IMAGE_SIZE / 3));
export const imageInputSchema = z.object({
  dataBase64: base64Schema,
  mimeType: z.string().max(100),
});
export const imageInspectionSchema = imageSizeSchema.safeExtend({
  format: imageFormatSchema,
  byteSize: z.number().int().positive().max(MAX_IMAGE_SIZE),
  previewBase64: base64Schema,
});
export type ImageInspection = z.infer<typeof imageInspectionSchema>;
export const imageProcessSchema = z.object({
  jobId: z.uuid(),
  input: imageInputSchema,
  crop: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().positive().max(1),
      height: z.number().positive().max(1),
    })
    .refine(
      (crop) =>
        crop.x + crop.width <= 1.000001 && crop.y + crop.height <= 1.000001,
      "裁剪区域不能超出图片",
    ),
  size: imageSizeSchema.optional(),
  format: imageFormatSchema,
  maxBytes: z.number().int().positive().max(MAX_IMAGE_SIZE).optional(),
  quality: z.number().int().min(60).max(100),
});
export type ImageProcessOptions = Omit<
  z.infer<typeof imageProcessSchema>,
  "jobId" | "input"
>;
export const imageOutputSchema = imageSizeSchema.safeExtend({
  format: imageFormatSchema,
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  byteSize: z.number().int().positive().max(MAX_IMAGE_SIZE),
  dataBase64: base64Schema,
  quality: z.number().int().min(60).max(100).nullable(),
  lossy: z.boolean(),
});
export type ImageOutput = z.infer<typeof imageOutputSchema>;
export const IMAGE_MIMES: Record<ImageFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
export function imageFileName(image: Blob, format: ImageFormat) {
  const name = image instanceof File ? image.name : "image";
  const cleaned = Array.from(name, (character) =>
    character.charCodeAt(0) < 32 ? "_" : character,
  ).join("");
  const stem =
    cleaned
      .replace(/\.[^.]*$/, "")
      .replace(/[<>:"/\\|?*]/g, "_")
      .slice(0, 100) || "image";
  return `${stem}-processed.${format === "jpeg" ? "jpg" : format}`;
}
export function imageSizeLabel(bytes: number) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KiB`
    : `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}
