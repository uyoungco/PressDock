import type { UploadImageRequest } from "@/types/cms";

export async function prepareImageUpload(
  file: File,
): Promise<UploadImageRequest> {
  if (
    !file.size ||
    file.size > 20 * 1024 * 1024 ||
    !/^image\/[a-z0-9.+-]+$/i.test(file.type)
  )
    throw new Error("请选择不超过 20 MiB 的图片");
  const src = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        image.onload = image.onerror = null;
        if (image.naturalWidth && image.naturalHeight) resolve();
        else reject(new Error("图片无法解码"));
      };
      image.onerror = () => {
        image.onload = image.onerror = null;
        reject(new Error("图片无法解码"));
      };
      image.src = src;
    });
  } finally {
    URL.revokeObjectURL(src);
  }
  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(file);
  });
  return { fileName: file.name, mimeType: file.type, dataBase64 };
}
