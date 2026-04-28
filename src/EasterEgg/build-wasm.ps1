param(
  [int]$Jobs = [Math]::Max(1, [Environment]::ProcessorCount)
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir '..\..')
$SrcDir = Join-Path $ScriptDir 'CnC_and_Red_Alert'
$BuildDir = Join-Path $SrcDir 'build-wasm'
$OutputDir = Join-Path $ProjectRoot 'public\ra'

Write-Host '=== Red Alert WASM Build ==='
Write-Host "Source: $SrcDir"
Write-Host "Output: $OutputDir"

function Require-Command($Name, $InstallHint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name not found. $InstallHint"
  }
}

Require-Command 'emcc' 'Install and activate emsdk before running this script.'
Require-Command 'emcmake' 'Install and activate emsdk before running this script.'
Require-Command 'emmake' 'Install and activate emsdk before running this script.'
Require-Command 'cmake' 'Install CMake, for example: winget install Kitware.CMake'
Require-Command 'pnpm' 'Install pnpm or run through Corepack before building.'

if (-not (Test-Path (Join-Path $SrcDir 'RA\bdata.cpp'))) {
  Write-Host 'Populating Daft-Freak/CnC_and_Red_Alert source...'
  Push-Location $ProjectRoot
  try {
    pnpm ra:ensure-source
  } finally {
    Pop-Location
  }
}

Write-Host 'Ensuring Emscripten SDL2 port is built...'
'#include <SDL2/SDL.h>' | emcc -xc - -sUSE_SDL=2 -c -o NUL 2>$null

Write-Host 'Configuring CMake with Emscripten...'
if (Test-Path $BuildDir) {
  Remove-Item -LiteralPath $BuildDir -Recurse -Force
}
emcmake cmake -B $BuildDir -S $SrcDir -DCMAKE_BUILD_TYPE=Release

Write-Host 'Building Red Alert (rasdl target)...'
emmake cmake --build $BuildDir --target rasdl "-j$Jobs"

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
Copy-Item -LiteralPath (Join-Path $BuildDir 'RA\rasdl.js') -Destination $OutputDir -Force
Copy-Item -LiteralPath (Join-Path $BuildDir 'RA\rasdl.wasm') -Destination $OutputDir -Force

Write-Host ''
Write-Host '=== Build complete ==='
Write-Host "WASM: $(Join-Path $OutputDir 'rasdl.wasm')"
Write-Host "JS:   $(Join-Path $OutputDir 'rasdl.js')"
