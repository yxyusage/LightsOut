#requires -Version 5.1
<#
  本地编译 Android Debug APK。

  用途：不需要 Android Studio，也不需要联网等 CI —— 直接用 E:\AndroidBuild 里
  已解压的 JDK 17 + Gradle 8.9 + Android SDK 编出 APK。

  用法（在仓库根目录）：
    powershell -ExecutionPolicy Bypass -File scripts\build-android-local.ps1
    powershell -ExecutionPolicy Bypass -File scripts\build-android-local.ps1 -Sign

  -Sign 会使用仓库根目录的 release\keystore.properties（若存在）做固定签名；
  不传时沿用 debug 签名。

  注意：本文件刻意只用 ASCII 标点与英文注释以外的**中文注释也可以**，
  但不能包含会被 PowerShell 5.1 当成 GBK 解析而破坏语法的字符组合 ——
  所以不要在字符串里放中文双引号或全角括号。
#>
param(
    [switch]$Sign,
    [string]$Toolchain = "E:\AndroidBuild"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$androidDir = Join-Path $repoRoot "platforms\android"

function Fail($message) {
    Write-Host ""
    Write-Host "构建失败: $message" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $Toolchain)) { Fail "找不到工具链目录 $Toolchain" }

$javaHome = Join-Path $Toolchain "jdk-17.0.20.1+1"
$gradle = Join-Path $Toolchain "gradle-8.9\bin\gradle.bat"
$sdk = Join-Path $Toolchain "sdk"

if (-not (Test-Path (Join-Path $javaHome "bin\java.exe"))) { Fail "找不到 JDK: $javaHome" }
if (-not (Test-Path $gradle)) { Fail "找不到 Gradle: $gradle" }
if (-not (Test-Path $sdk)) { Fail "找不到 Android SDK: $sdk" }

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:PATH = "$javaHome\bin;$sdk\platform-tools;$env:PATH"

Write-Host "JDK:    $javaHome" -ForegroundColor DarkGray
Write-Host "Gradle: $gradle" -ForegroundColor DarkGray
Write-Host "SDK:    $sdk" -ForegroundColor DarkGray
Write-Host ""

# 固定签名：keystore.properties 由 CI 或用户在本机放置；不存在时用 debug 签名
$signingProps = Join-Path $repoRoot "release\keystore.properties"
if ($Sign -and -not (Test-Path $signingProps)) {
    Write-Host "提示: 未找到 $signingProps，将使用 debug 签名" -ForegroundColor Yellow
}

Push-Location $androidDir
try {
    Write-Host "开始编译 assembleDebug ..." -ForegroundColor Cyan
    & $gradle assembleDebug --no-daemon --console=plain
    if ($LASTEXITCODE -ne 0) { Fail "Gradle 返回 $LASTEXITCODE" }
}
finally {
    Pop-Location
}

$apk = Get-ChildItem (Join-Path $androidDir "app\build\outputs\apk\debug") -Filter "*.apk" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $apk) { Fail "编译结束但没找到 APK" }

$hash = (Get-FileHash $apk.FullName -Algorithm SHA256).Hash.ToLower()

Write-Host ""
Write-Host "APK: $($apk.FullName)" -ForegroundColor Green
Write-Host ("体积: " + [math]::Round($apk.Length / 1MB, 2) + " MB")
Write-Host ("sha256: " + $hash)
