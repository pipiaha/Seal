#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$DataDir,
    [string]$NodeExecutable,
    [string]$HypitRoot,
    [string]$BrowserExecutable
)

$ErrorActionPreference = 'Stop'
$previewRepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$previewExecutable = Join-Path $previewRepoRoot '.local\cache\edit-browser-tools\Seal-preview.exe'
$previewNextExecutable = Join-Path $previewRepoRoot '.local\cache\edit-browser-tools\Seal-preview-next.exe'
if (Test-Path -LiteralPath $previewNextExecutable -PathType Leaf) { $previewExecutable = $previewNextExecutable }
if (-not (Test-Path -LiteralPath $previewExecutable -PathType Leaf)) {
    throw 'The desktop preview has not been built yet.'
}
if (-not $DataDir) { $DataDir = Join-Path $previewRepoRoot '.local\project-workbench-debug\edit-manual-preview' }
if (-not $NodeExecutable) { $NodeExecutable = Join-Path $previewRepoRoot '.local\cache\edit-runtime-tools\node-v24.15.0-win-x64\node.exe' }
if (-not $HypitRoot) { $HypitRoot = Join-Path (Split-Path $previewRepoRoot) 'hypit' }
if (-not $BrowserExecutable) {
    $BrowserExecutable = Join-Path $env:USERPROFILE '.cache\puppeteer\chrome-headless-shell\win64-153.0.8010.36\chrome-headless-shell-win64\chrome-headless-shell.exe'
}
foreach ($previewTool in @($NodeExecutable, $BrowserExecutable)) {
    if (-not (Test-Path -LiteralPath $previewTool -PathType Leaf)) { throw "Preview tool is missing: $previewTool" }
}
if (-not (Test-Path -LiteralPath (Join-Path $HypitRoot 'skills\hypit\SKILL.md') -PathType Leaf)) { throw 'The official Hypit distribution is missing.' }
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$previewAgentConfigFile = Join-Path $DataDir 'agent_config.json'
$previewAgentConfig = if (Test-Path -LiteralPath $previewAgentConfigFile) { Get-Content -LiteralPath $previewAgentConfigFile -Raw | ConvertFrom-Json } else { [pscustomobject]@{ model = ''; hostCommand = ''; hostArgs = @(); updatedAt = '' } }
$previewAgentConfig.hostCommand = [IO.Path]::GetFullPath($NodeExecutable)
$previewAgentConfig.hostArgs = @((Join-Path $previewRepoRoot 'agent-host\server.mjs'))
$previewAgentConfig.updatedAt = [DateTime]::UtcNow.ToString('o')
[IO.File]::WriteAllText($previewAgentConfigFile, ($previewAgentConfig | ConvertTo-Json -Depth 8), (New-Object System.Text.UTF8Encoding($false)))
$env:CANVAS_DESKTOP_DATA_DIR = [IO.Path]::GetFullPath($DataDir)
$env:BEEFTV_EDIT_HOST_ENTRY = Join-Path $previewRepoRoot 'edit-host\server.mjs'
$env:BEEFTV_EDIT_NODE = [IO.Path]::GetFullPath($NodeExecutable)
$env:BEEFTV_HYPIT_ROOT = [IO.Path]::GetFullPath($HypitRoot)
$env:HYPERFRAMES_BROWSER_PATH = [IO.Path]::GetFullPath($BrowserExecutable)
$env:PRODUCER_HEADLESS_SHELL_PATH = [IO.Path]::GetFullPath($BrowserExecutable)
$env:HYPERFRAMES_TELEMETRY_DISABLED = '1'
$previewPluginRoot = Join-Path $previewRepoRoot '.local\cache\creator-official-plugins'
if (Test-Path -LiteralPath (Join-Path $previewPluginRoot 'openai-audio.beeftv-plugin')) { $env:CANVAS_OFFICIAL_PLUGIN_DIR = $previewPluginRoot }
$previewAsrRoot = Join-Path $previewRepoRoot '.local\cache\local-asr-runtime\prepared'
if (Test-Path -LiteralPath (Join-Path $previewAsrRoot 'runtime-manifest.json')) {
    $env:BEEFTV_WHISPER_CLI = Join-Path $previewAsrRoot 'bin\whisper-cli.exe'
    $env:BEEFTV_WHISPER_MODEL = Join-Path $previewAsrRoot 'models\ggml-base.bin'
}
$env:GIN_MODE = 'release'
# This is the interactive preview requested for manual acceptance.
Start-Process -FilePath $previewExecutable -WorkingDirectory $previewRepoRoot -PassThru | Select-Object Id, ProcessName
