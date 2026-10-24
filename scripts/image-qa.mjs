// Isolated browser acceptance harness. Production never serves this endpoint.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, ".tools", "image-qa");
await mkdir(directory, { recursive: true });
const env = { ...process.env };
const cargoHome = path.join(root, ".tools", "cargo");
const localCargo = path.join(
  cargoHome,
  "bin",
  process.platform === "win32" ? "cargo.exe" : "cargo",
);
const pathKey =
  Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
if (existsSync(localCargo)) {
  env.CARGO_HOME = cargoHome;
  env.RUSTUP_HOME = path.join(root, ".tools", "rustup");
  env[pathKey] =
    `${path.dirname(localCargo)}${path.delimiter}${env[pathKey] ?? ""}`;
}
console.log("编译隔离验收使用的 Rust 测试编码器…");
const built = spawnSync(
  existsSync(localCargo) ? localCargo : "cargo",
  [
    "test",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--locked",
    "--lib",
    "--no-run",
    "--message-format=json",
  ],
  { cwd: root, env, encoding: "utf8", maxBuffer: 30 * 1024 * 1024 },
);
if (built.status !== 0)
  throw new Error(built.stderr || built.error?.message || "Rust 测试编译失败");
const binary = built.stdout
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .find(
    (value) =>
      value.reason === "compiler-artifact" &&
      value.profile.test &&
      value.executable,
  )?.executable;
if (!binary) throw new Error("找不到 Rust 测试编码器");

const entry = path.join(directory, "entry.tsx");
await writeFile(
  entry,
  `
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ImageProcessor } from "/src/features/images/ImageProcessor.tsx";
import "/src/styles/globals.css";
function Acceptance() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState("none");
  const [confirmed, setConfirmed] = useState("");
  const presets = {
    none: {}, square: { size: { width: 750, height: 750 }, format: "jpeg", maxBytes: 102400 },
    format: { format: "webp" }, size: { size: { width: 750, height: 750 } }, limit: { maxBytes: 1024 },
  };
  return <main className="mx-auto max-w-[1440px] p-6">
    <h1 className="text-xl font-semibold">图片处理组件 · 隔离验收</h1>
    <p className="my-2 text-sm text-muted-foreground">真实 Rust 编码 · 不连接 CMS · 确认仅显示结果，不写出文件</p>
    <div className="my-4 flex flex-wrap items-center gap-4">
      <input aria-label="验收图片" type="file" accept="image/*" onChange={e => { setConfirmed(""); setFile(e.target.files?.[0] ?? null); }}/>
      <label>验收预设 <select aria-label="验收预设" value={mode} onChange={e => {setConfirmed(""); setMode(e.target.value);}}>
        <option value="none">无预设</option><option value="square">750 × 750 / JPG / 100 KiB 全锁定</option>
        <option value="format">仅 WebP 格式锁定</option><option value="size">仅 750 × 750 尺寸锁定</option>
        <option value="limit">仅 1 KiB 体积锁定</option>
      </select></label>
      <button onClick={() => document.documentElement.classList.toggle("dark")}>切换深浅色</button>
    </div>
    {file && <ImageProcessor image={file} preset={presets[mode]} onCancel={() => setFile(null)} onConfirm={result => setConfirmed(result.width + " × " + result.height + " / " + result.format + " / " + result.byteSize + " B")}/>}
    {confirmed && <p role="status" className="mt-4">已确认真实结果：{confirmed}</p>}
  </main>;
}
const root = import.meta.hot?.data.root ?? createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(<Acceptance/>);
`,
  "utf8",
);

const token = randomUUID();
const workers = new Map();
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 1431, strictPort: true, open: false },
  plugins: [
    {
      name: "isolated-image-qa",
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url === "/__image-qa") {
            if (
              request.method !== "POST" ||
              request.headers["x-image-qa"] !== token
            ) {
              response.writeHead(403).end();
              return;
            }
            const id = randomUUID();
            const inputPath = path.join(directory, `${id}-input.json`);
            const outputPath = path.join(directory, `${id}-output.json`);
            response.setHeader("content-type", "application/json");
            try {
              let length = 0;
              const chunks = [];
              for await (const chunk of request) {
                length += chunk.length;
                if (length > 30 * 1024 * 1024)
                  throw new Error("验收输入超过限制");
                chunks.push(chunk);
              }
              const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
              if (body.command === "image_cancel") {
                workers.get(body.args.jobId)?.kill();
                response.end(JSON.stringify({ ok: true, value: null }));
                return;
              }
              if (!["image_inspect", "image_process"].includes(body.command))
                throw new Error("验收不允许此命令");
              const jobId = body.args.jobId ?? body.args.request?.jobId;
              if (workers.size >= 4) throw new Error("验收任务繁忙");
              await writeFile(inputPath, JSON.stringify(body));
              const child = spawn(
                binary,
                ["imaging::tests::qa_bridge", "--exact", "--nocapture"],
                {
                  cwd: root,
                  env: {
                    ...env,
                    PRESSDOCK_IMAGE_QA_INPUT: inputPath,
                    PRESSDOCK_IMAGE_QA_OUTPUT: outputPath,
                  },
                  stdio: "ignore",
                  windowsHide: true,
                },
              );
              workers.set(jobId, child);
              try {
                await new Promise((resolve, reject) => {
                  child.once("error", reject);
                  child.once("exit", (code) =>
                    code === 0
                      ? resolve()
                      : reject(new Error("验收任务已中止或失败")),
                  );
                });
                response.end(await readFile(outputPath));
              } finally {
                workers.delete(jobId);
              }
            } catch (error) {
              response.end(
                JSON.stringify({
                  ok: false,
                  error: { code: "QA_ERROR", message: error.message },
                }),
              );
            } finally {
              await Promise.all([
                rm(inputPath, { force: true }),
                rm(outputPath, { force: true }),
              ]);
            }
            return;
          }
          if (request.url === "/image-qa") {
            const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div>
            <script>window.__TAURI_INTERNALS__={invoke:async(command,args)=>{const r=await fetch('/__image-qa',{method:'POST',headers:{'content-type':'application/json','x-image-qa':'${token}'},body:JSON.stringify({command,args})});const v=await r.json();if(!v.ok)throw v.error;return v.value;}};</script>
            <script type="module" src="/@fs/${entry.replaceAll("\\", "/")}"></script></body></html>`;
            response.setHeader("content-type", "text/html; charset=utf-8");
            response.end(await vite.transformIndexHtml("/image-qa", html));
            return;
          }
          next();
        });
      },
    },
  ],
});
await server.listen();
console.log(
  "隔离验收：http://127.0.0.1:1431/image-qa（仅本机；不提供系统另存为）",
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    for (const child of workers.values()) child.kill();
    await server.close();
    process.exit();
  });
