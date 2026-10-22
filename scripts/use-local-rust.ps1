# 仅对当前 PowerShell 会话生效。使用：. .\scripts\use-local-rust.ps1
$pressdockRoot = Split-Path -Parent $PSScriptRoot
$pressdockCargo = Join-Path $pressdockRoot '.tools\cargo'
if (Test-Path -LiteralPath (Join-Path $pressdockCargo 'bin\cargo.exe')) {
  $env:CARGO_HOME = $pressdockCargo
  $env:RUSTUP_HOME = Join-Path $pressdockRoot '.tools\rustup'
  $env:PATH = (Join-Path $pressdockCargo 'bin') + [IO.Path]::PathSeparator + $env:PATH
}
