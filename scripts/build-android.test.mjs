import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildAndroid } from "./build-android.mjs";

const apkRelative =
  "src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk";

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "pressdock android test-"));
  t.after(() => {
    assert.ok(root.startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(path.join(root, "scripts"));
  return root;
}

function mockTauri(root, source) {
  writeFileSync(path.join(root, "scripts/tauri.mjs"), source);
}

for (const demo of [false, true]) {
  test(`macOS 路径包含空格时构建${demo ? "演示" : "普通"}包，传递标识并归档本次产物`, async (t) => {
    const root = fixture(t);
    mockTauri(
      root,
      `import { mkdirSync, writeFileSync } from "node:fs";
       import path from "node:path";
       writeFileSync("invocation.json", JSON.stringify({
         args: process.argv.slice(2), demo: process.env.PRESSDOCK_DEMO
       }));
       const apk = ${JSON.stringify(apkRelative)};
       mkdirSync(path.dirname(apk), { recursive: true });
       writeFileSync(apk, "演示测试产物");
       console.log("测试构建日志");`,
    );
    assert.equal(await buildAndroid({ root, platform: "darwin", demo }), 0);
    const invocation = JSON.parse(
      readFileSync(path.join(root, "invocation.json"), "utf8"),
    );
    assert.equal(invocation.demo, demo ? "1" : "0");
    assert.deepEqual(invocation.args, [
      "android",
      "build",
      "--debug",
      "--target",
      "aarch64",
      "--apk",
      ...(demo ? ["--features", "android-demo"] : []),
    ]);
    const artifact = `artifacts/PressDock-android-${demo ? "demo" : "debug"}-arm64.apk`;
    assert.equal(
      readFileSync(path.join(root, artifact), "utf8"),
      "演示测试产物",
    );
    assert.match(
      readFileSync(path.join(root, ".tools/android/build.log"), "utf8"),
      /测试构建日志/,
    );
  });
}

test("构建失败时保留日志，不覆盖上次归档的 APK", async (t) => {
  const root = fixture(t);
  mkdirSync(path.join(root, "artifacts"));
  const artifact = path.join(
    root,
    "artifacts/PressDock-android-debug-arm64.apk",
  );
  writeFileSync(artifact, "上次测试产物");
  mockTauri(root, 'console.error("测试编译失败"); process.exitCode = 2;');
  await assert.rejects(
    buildAndroid({ root, platform: "darwin" }),
    /Android 编译失败/,
  );
  assert.equal(readFileSync(artifact, "utf8"), "上次测试产物");
  assert.match(
    readFileSync(path.join(root, ".tools/android/build.log"), "utf8"),
    /测试编译失败/,
  );
});

test("子进程成功但未生成 APK 时拒绝归档旧产物", async (t) => {
  const root = fixture(t);
  const apk = path.join(root, apkRelative);
  mkdirSync(path.dirname(apk), { recursive: true });
  writeFileSync(apk, "过期测试产物");
  mockTauri(root, 'console.log("测试未生成 APK");');
  await assert.rejects(
    buildAndroid({ root, platform: "darwin" }),
    /未找到本次构建的 Android APK/,
  );
  assert.equal(
    existsSync(path.join(root, "artifacts/PressDock-android-debug-arm64.apk")),
    false,
  );
});

test("Tauri 保留显式 Android 工具链配置，不被工作区工具链覆盖", (t) => {
  const root = fixture(t);
  copyFileSync(
    new URL("./tauri.mjs", import.meta.url),
    path.join(root, "scripts/tauri.mjs"),
  );
  mkdirSync(path.join(root, ".tools/android/java/local-jdk/bin"), {
    recursive: true,
  });
  writeFileSync(
    path.join(
      root,
      `.tools/android/java/local-jdk/bin/${process.platform === "win32" ? "java.exe" : "java"}`,
    ),
    "测试 JDK",
  );
  mkdirSync(path.join(root, ".tools/android/sdk/ndk/28.2.13676358"), {
    recursive: true,
  });
  mkdirSync(path.join(root, "node_modules/@tauri-apps/cli"), {
    recursive: true,
  });
  writeFileSync(
    path.join(root, "node_modules/@tauri-apps/cli/tauri.js"),
    "console.log(JSON.stringify({ JAVA_HOME: process.env.JAVA_HOME, ANDROID_HOME: process.env.ANDROID_HOME, NDK_HOME: process.env.NDK_HOME }));",
  );
  const expected = {
    JAVA_HOME: path.join(root, "custom JDK"),
    ANDROID_HOME: path.join(root, "custom SDK"),
    NDK_HOME: path.join(root, "custom NDK"),
  };
  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts/tauri.mjs"), "android", "build"],
    {
      env: { ...process.env, ...expected },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const actual = JSON.parse(result.stdout);
  for (const [key, value] of Object.entries(expected))
    assert.equal(actual[key], value);
});
