param([switch]$Demo)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
. "$PSScriptRoot/use-local-android.ps1"
$env:GRADLE_USER_HOME = Join-Path $taskRoot '.tools/android/gradle'
$env:PRESSDOCK_DEMO = if ($Demo) { '1' } else { '0' }
$taskLog = Join-Path $taskRoot '.tools/android/build.log'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $taskLog) | Out-Null

if ($Demo) {
    & cmd.exe /d /c 'npm.cmd run tauri -- android build --debug --target aarch64 --apk --features android-demo > .tools\android\build.log 2>&1'
} else {
    & cmd.exe /d /c 'npm.cmd run tauri -- android build --debug --target aarch64 --apk > .tools\android\build.log 2>&1'
}
$taskBuildCode = $LASTEXITCODE
if ($taskBuildCode -ne 0) {
    $taskOutput = Get-Content -Raw -LiteralPath $taskLog
    if ($taskOutput -notmatch 'Creation symbolic link is not allowed for this system') {
        Get-Content -LiteralPath $taskLog -Tail 70
        throw 'Android 编译失败，完整日志见 .tools/android/build.log'
    }
    # Tauri 已完成本次前端和 Rust 构建；只替代需要 Windows 开发者模式的链接步骤。
    Write-Host '使用文件复制完成原生库打包（当前 Windows 未开放符号链接权限）。'
    $taskLib = Join-Path $taskRoot 'src-tauri/target/aarch64-linux-android/debug/libpressdock_lib.so'
    $taskJni = Join-Path $taskRoot 'src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a'
    New-Item -ItemType Directory -Force -Path $taskJni | Out-Null
    Copy-Item -LiteralPath $taskLib -Destination (Join-Path $taskJni 'libpressdock_lib.so') -Force
    & "$env:NDK_HOME/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-strip.exe" --strip-unneeded (Join-Path $taskJni 'libpressdock_lib.so')
    if ($LASTEXITCODE -ne 0) { throw 'Android 原生库符号处理失败' }
    & "$taskRoot/src-tauri/gen/android/gradlew.bat" -p "$taskRoot/src-tauri/gen/android" :app:clean assembleArm64Debug -x rustBuildArm64Debug --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'Android Gradle 打包失败' }
}
$taskApk = Join-Path $taskRoot 'src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk'
if (!(Test-Path -LiteralPath $taskApk)) { throw '未找到本次构建的 Android APK' }
New-Item -ItemType Directory -Force -Path (Join-Path $taskRoot 'artifacts') | Out-Null
$taskArtifact = if ($Demo) { 'artifacts/PressDock-android-demo-arm64.apk' } else { 'artifacts/PressDock-android-debug-arm64.apk' }
Copy-Item -LiteralPath $taskApk -Destination (Join-Path $taskRoot $taskArtifact) -Force
Write-Host "APK: $taskArtifact"
