import { spawn } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(import.meta.dirname, "..");

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

export async function buildAndroid({
  root = projectRoot,
  platform = process.platform,
  demo = false,
} = {}) {
  if (platform === "win32") {
    // 保留 Windows 的本地工具链及符号链接权限兼容逻辑。
    return run(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(root, "scripts", "build-android.ps1"),
        ...(demo ? ["-Demo"] : []),
      ],
      { cwd: root, stdio: "inherit" },
    );
  }

  const logPath = path.join(root, ".tools", "android", "build.log");
  const apkPath = path.join(
    root,
    "src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk",
  );
  mkdirSync(path.dirname(logPath), { recursive: true });
  // 防止一次未生成 APK 的构建被误判为成功并复制旧产物。
  rmSync(apkPath, { force: true });
  const log = openSync(logPath, "w");
  let code;
  console.log("正在构建 ARM64 调试 APK，完整日志见 .tools/android/build.log");
  try {
    code = await run(
      process.execPath,
      [
        path.join(root, "scripts", "tauri.mjs"),
        "android",
        "build",
        "--debug",
        "--target",
        "aarch64",
        "--apk",
        ...(demo ? ["--features", "android-demo"] : []),
      ],
      {
        cwd: root,
        env: { ...process.env, PRESSDOCK_DEMO: demo ? "1" : "0" },
        stdio: ["inherit", log, log],
      },
    );
  } finally {
    closeSync(log);
  }
  if (code !== 0) {
    console.error(
      readFileSync(logPath, "utf8").split(/\r?\n/).slice(-70).join("\n"),
    );
    throw new Error("Android 编译失败，完整日志见 .tools/android/build.log");
  }

  if (!existsSync(apkPath)) throw new Error("未找到本次构建的 Android APK");
  const artifact = `artifacts/PressDock-android-${demo ? "demo" : "debug"}-arm64.apk`;
  mkdirSync(path.join(root, "artifacts"), { recursive: true });
  copyFileSync(apkPath, path.join(root, artifact));
  console.log(`APK: ${artifact}`);
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== "--demo")) {
      throw new Error("用法：node scripts/build-android.mjs [--demo]");
    }
    process.exitCode = await buildAndroid({ demo: args.includes("--demo") });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
