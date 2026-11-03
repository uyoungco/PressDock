$taskAndroidRoot = Join-Path $PSScriptRoot '..\.tools\android'
$taskJava = Get-ChildItem (Join-Path $taskAndroidRoot 'java') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $taskJava) { throw '缺少本地 JDK，请按 docs/android-plan.md 配置工具链。' }
$env:JAVA_HOME = $taskJava.FullName
$env:ANDROID_HOME = Join-Path $taskAndroidRoot 'sdk'
$env:NDK_HOME = Join-Path $env:ANDROID_HOME 'ndk\28.2.13676358'
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
. (Join-Path $PSScriptRoot 'use-local-rust.ps1')
