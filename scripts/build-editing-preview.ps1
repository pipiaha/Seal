#Requires -Version 5.1
[CmdletBinding()]
param([switch]$BuildWeb, [string]$OutputName = 'Seal-preview-next.exe')

$ErrorActionPreference = 'Stop'
$previewBuildRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$previewBuildWeb = Join-Path $previewBuildRoot 'web\dist'
$previewBuildEmbedded = Join-Path $previewBuildRoot 'backend\cmd\desktop\frontend\dist'
if ($OutputName -notmatch '^Seal-preview(?:-[a-z0-9-]+)?\.exe$') { throw 'Invalid preview output filename.' }
$previewBuildOutput = Join-Path (Join-Path $previewBuildRoot '.local\cache\edit-browser-tools') $OutputName
$previewBuildCache = Split-Path $previewBuildOutput
New-Item -ItemType Directory -Force -Path (Join-Path $previewBuildCache 'cli') | Out-Null

if ($BuildWeb) {
    $previewBuildBun = Join-Path $previewBuildRoot '.local\cache\edit-runtime-tools\bun-windows-x64\bun.exe'
    Push-Location (Join-Path $previewBuildRoot 'web')
    try {
        & $previewBuildBun run build
        if ($LASTEXITCODE -ne 0) { throw 'The frontend build failed.' }
    } finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath (Join-Path $previewBuildWeb 'index.html'))) { throw 'Build web/dist before packaging the preview.' }

# This is the exact subtree embedded by frontend.go, not its parent directory.
if ([IO.Path]::GetFullPath($previewBuildEmbedded) -ne (Join-Path $previewBuildRoot 'backend\cmd\desktop\frontend\dist')) { throw 'Unexpected embedded build directory.' }
if (Test-Path -LiteralPath $previewBuildEmbedded) { Remove-Item -LiteralPath $previewBuildEmbedded -Recurse -Force }
New-Item -ItemType Directory -Force -Path $previewBuildEmbedded | Out-Null
New-Item -ItemType File -Force -Path (Join-Path $previewBuildEmbedded '.gitkeep') | Out-Null
Get-ChildItem -LiteralPath $previewBuildWeb | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $previewBuildEmbedded -Recurse -Force
}
$previewBuildIndex = Join-Path $previewBuildWeb 'index.html'
if ((Get-FileHash -LiteralPath $previewBuildIndex).Hash -ne (Get-FileHash -LiteralPath (Join-Path $previewBuildEmbedded 'index.html')).Hash) { throw 'Desktop embedded entry does not match web/dist.' }
$previewBuildHTML = Get-Content -LiteralPath $previewBuildIndex -Raw
$previewBuildEntry = [regex]::Match($previewBuildHTML, '<script type="module"[^>]+src="([^"]+)"').Groups[1].Value
if (-not $previewBuildEntry) { throw 'The frontend module entry was not found.' }

$previewBuildOldCGO = $env:CGO_ENABLED
$previewBuildOldCC = $env:CC
$previewBuildOldExperiment = $env:GOEXPERIMENT
$previewBuildResource = Join-Path $previewBuildRoot 'backend\cmd\desktop\seal_preview_windows.syso'
$previewBuildRC = Join-Path $previewBuildCache 'seal-preview.rc'
$previewBuildIcon = (Join-Path $previewBuildRoot 'assets\seal\app-icon.ico').Replace('\', '/')
$previewBuildWindres = Join-Path (Split-Path 'E:/mingw64/bin/gcc.exe') 'windres.exe'
$previewBuildVersion = (Get-Content -LiteralPath (Join-Path $previewBuildRoot 'VERSION') -Raw).Trim().TrimStart('v')
$previewBuildNumericVersion = ([regex]::Match($previewBuildVersion, '^\d+\.\d+\.\d+').Value.Replace('.', ',')) + ',0'
@"
1 ICON "$previewBuildIcon"
1 VERSIONINFO
FILEVERSION $previewBuildNumericVersion
PRODUCTVERSION $previewBuildNumericVersion
FILEFLAGSMASK 0x3fL
FILEFLAGS 0x0L
FILEOS 0x40004L
FILETYPE 0x1L
BEGIN
 BLOCK "StringFileInfo"
 BEGIN
  BLOCK "040904b0"
  BEGIN
   VALUE "CompanyName", "Seal\0"
   VALUE "FileDescription", "Seal video workspace\0"
   VALUE "FileVersion", "$previewBuildVersion\0"
   VALUE "InternalName", "Seal\0"
   VALUE "OriginalFilename", "Seal-preview.exe\0"
   VALUE "ProductName", "Seal\0"
   VALUE "ProductVersion", "$previewBuildVersion\0"
  END
 END
 BLOCK "VarFileInfo"
 BEGIN
  VALUE "Translation", 0x409, 1200
 END
END
"@ | Set-Content -LiteralPath $previewBuildRC -Encoding ascii
Push-Location (Join-Path $previewBuildRoot 'backend')
try {
    $env:CGO_ENABLED = '1'
    $env:CC = 'E:/mingw64/bin/gcc.exe'
    $env:GOEXPERIMENT = 'nodwarf5'
    & $previewBuildWindres --input $previewBuildRC --output $previewBuildResource --output-format coff --target pe-x86-64
    if ($LASTEXITCODE -ne 0) { throw 'The desktop icon resource build failed.' }
    $previewBuildVersionTag = (Get-Content -LiteralPath (Join-Path $previewBuildRoot 'VERSION') -Raw).Trim()
    # A preview runs against source folders and cannot be replaced as a complete Seal.exe installation.
    $previewBuildLdflags = "-H windowsgui -X infinite-canvas/backend/internal/buildinfo.Version=$previewBuildVersionTag -X infinite-canvas/backend/internal/desktopupdate.FeedURL= -X infinite-canvas/backend/internal/desktopupdate.PublicKey="
    go build -tags production -ldflags $previewBuildLdflags -o $previewBuildOutput ./cmd/desktop
    if ($LASTEXITCODE -ne 0) { throw 'The desktop build failed.' }
    go build -o (Join-Path $previewBuildCache 'cli\seal.exe') ./cmd/beeftv
    if ($LASTEXITCODE -ne 0) { throw 'The bundled CLI build failed.' }
} finally {
    if (Test-Path -LiteralPath $previewBuildResource) { Remove-Item -LiteralPath $previewBuildResource }
    Pop-Location
    $env:CGO_ENABLED = $previewBuildOldCGO
    $env:CC = $previewBuildOldCC
    $env:GOEXPERIMENT = $previewBuildOldExperiment
}
foreach ($previewBuildNotice in @('LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md')) {
    Copy-Item -LiteralPath (Join-Path $previewBuildRoot $previewBuildNotice) -Destination $previewBuildCache -Force
}
$previewBuildBinary = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($previewBuildOutput))
if (-not $previewBuildBinary.Contains($previewBuildEntry)) { throw 'The executable does not contain the new frontend entry.' }
Write-Output ('PASS: staged and compiled frontend entry ' + $previewBuildEntry)
Write-Output $previewBuildOutput
