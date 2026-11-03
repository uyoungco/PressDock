import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cargoHome = path.join(root, ".tools", "cargo");
const localCargo = path.join(
  cargoHome,
  "bin",
  process.platform === "win32" ? "cargo.exe" : "cargo",
);
const env = { ...process.env };
if (process.argv[2] === "android") {
  env.VITE_PRESSDOCK_PLATFORM = "android";
  env.VITE_PRESSDOCK_DEMO = env.PRESSDOCK_DEMO === "1" ? "1" : "0";
  const androidRoot = path.join(root, ".tools", "android");
  env.GRADLE_USER_HOME ??= path.join(androidRoot, "gradle");
  const { readdirSync } = await import("node:fs");
  const javaRoot = path.join(androidRoot, "java");
  if (existsSync(javaRoot)) {
    const java = readdirSync(javaRoot, { withFileTypes: true }).find((entry) =>
      entry.isDirectory(),
    );
    if (java) env.JAVA_HOME = path.join(javaRoot, java.name);
  }
  if (existsSync(path.join(androidRoot, "sdk"))) {
    env.ANDROID_HOME = path.join(androidRoot, "sdk");
    env.NDK_HOME = path.join(env.ANDROID_HOME, "ndk", "28.2.13676358");
  }
}
const pathKey =
  Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
if (existsSync(localCargo)) {
  env.CARGO_HOME = cargoHome;
  env.RUSTUP_HOME = path.join(root, ".tools", "rustup");
  env[pathKey] =
    `${path.dirname(localCargo)}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${env[pathKey] ?? ""}`;
}
const cli = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: root,
  env,
  stdio: "inherit",
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
