import { useState } from "react";
import { createRoot } from "react-dom/client";
import { useMaterialImage } from "/src/features/channels/use-material-image";
import { blankInput } from "/src/features/channels/edit-buffer";
import { imageProcessSchema } from "/src/features/images/model";
import "/src/styles/globals.css";

const query = new URLSearchParams(location.search);
const mode = query.get("preset") ?? "locked";
const preset =
  mode === "locked"
    ? { format: "jpeg", size: { width: 560, height: 248 }, maxBytes: 79 * 1024 }
    : mode === "mixed"
      ? { format: "jpeg" }
      : {};
const canvas = document.createElement("canvas");
canvas.width = 506;
canvas.height = 180;
const context = canvas.getContext("2d")!;
context.fillStyle = "#d7ded6";
context.fillRect(0, 0, 506, 180);
context.fillStyle = "#8d9e96";
context.fillRect(0, 0, 126, 180);
context.fillStyle = "#b7c3b3";
context.fillRect(380, 0, 126, 180);
context.fillStyle = "#36473f";
context.font = "24px sans-serif";
context.fillText("隔离演示 · 裁剪检查", 145, 84);
context.font = "14px sans-serif";
context.fillText("506 × 180 px / 原图独立保留", 145, 112);
const source = await new Promise<Blob>((resolve) =>
  canvas.toBlob((blob) => resolve(blob!), "image/png"),
);
const file = new File([source], "隔离演示横幅.png", { type: "image/png" });
async function bitmap(input: { dataBase64: string; mimeType: string }) {
  return createImageBitmap(
    new Blob(
      [Uint8Array.from(atob(input.dataBase64), (v) => v.charCodeAt(0))],
      { type: input.mimeType },
    ),
  );
}
Object.assign(window, {
  isTauri: true,
  __TAURI_INTERNALS__: {
    async invoke(command: string, args: Record<string, unknown> = {}) {
      if (command === "list_channel_image_presets")
        return [
          {
            channel: "隔离演示",
            subChannel: "轮播小图",
            titlePic: preset,
            titlePic2: {},
          },
        ];
      if (command === "image_cancel") return null;
      if (command === "image_inspect") {
        const input = args.input as { dataBase64: string; mimeType: string };
        const image = await bitmap(input);
        const c = document.createElement("canvas");
        c.width = image.width;
        c.height = image.height;
        c.getContext("2d")!.drawImage(image, 0, 0);
        const result = {
          width: image.width,
          height: image.height,
          format: "png",
          byteSize: atob(input.dataBase64).length,
          previewBase64: c.toDataURL("image/png").split(",")[1],
        };
        image.close();
        return result;
      }
      if (command === "image_process") {
        const request = imageProcessSchema.parse(args.request);
        if (query.has("failure"))
          throw {
            code: "DEMO_PROCESS_ERROR",
            message:
              "隔离演示错误：" +
              "输出体积无法满足上限，请调整参数后重试。".repeat(15),
          };
        const image = await bitmap(request.input);
        const c = document.createElement("canvas");
        c.width =
          request.size?.width ?? Math.round(image.width * request.crop.width);
        c.height =
          request.size?.height ??
          Math.round(image.height * request.crop.height);
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(
          image,
          request.crop.x * image.width,
          request.crop.y * image.height,
          request.crop.width * image.width,
          request.crop.height * image.height,
          0,
          0,
          c.width,
          c.height,
        );
        const mimeType = `image/${request.format}`;
        const dataBase64 = c
          .toDataURL(mimeType, request.quality / 100)
          .split(",")[1];
        image.close();
        if (request.maxBytes && atob(dataBase64).length > request.maxBytes)
          throw {
            code: "DEMO_LIMIT",
            message: "隔离演示：结果超出体积上限，请调高上限",
          };
        return {
          width: c.width,
          height: c.height,
          format: request.format,
          mimeType,
          byteSize: atob(dataBase64).length,
          dataBase64,
          quality: request.format === "png" ? null : request.quality,
          lossy: request.format !== "png",
        };
      }
      throw {
        code: "DEMO_WRITE_BLOCKED",
        message: "隔离演示：上传及 CMS 写操作已阻断，未修改线上素材",
      };
    },
  },
});
function Harness() {
  const [input, setInput] = useState({
    ...blankInput(),
    channel: "隔离演示",
    subChannel: "轮播小图",
    title: "演示素材",
    writer: "演示编辑",
  });
  const image = useMaterialImage(input, false, setInput, () => {}, true);
  return (
    <>
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          fontSize: 12,
          padding: "4px 12px",
          background: "#f7f8fa",
          borderBottom: "1px solid #ddd",
        }}
      >
        隔离验收 · 演示数据 · 浏览器测试编码器 · 上传 / CMS 写操作全部阻断
      </div>
      <main style={{ padding: "80px 32px" }}>
        <h1>渠道素材图片 · 隔离验收</h1>
        <p>预设模式：{mode}</p>
        <label htmlFor="material-titlePic">主图地址</label>
        <input id="material-titlePic" value={input.titlePic} readOnly />
        <button id="open-image" onClick={() => image.start(file, "titlePic")}>
          选择演示图片
        </button>
      </main>
      {image.dialog}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
