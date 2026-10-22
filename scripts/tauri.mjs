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
