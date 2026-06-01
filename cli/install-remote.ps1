# Remote installer for the /enhance Claude Code slash command (Windows / PowerShell).
# Downloads the CLI files from the public repo into %USERPROFILE%\.claude\ — no clone.
# PowerShell equivalent of cli/install-remote.sh.

$ErrorActionPreference = 'Stop'

$BaseUrl = 'https://raw.githubusercontent.com/prak-mtl/prompt-enhancer/main/cli'

$HomeDir      = $env:USERPROFILE
$DestCommands = Join-Path $HomeDir '.claude\commands'
$DestScripts  = Join-Path $HomeDir '.claude\scripts'

New-Item -ItemType Directory -Force -Path $DestCommands | Out-Null
New-Item -ItemType Directory -Force -Path $DestScripts  | Out-Null

# Download into a temp dir first; move into place only after all three succeed,
# so a failed download can never leave a partial install. $ErrorActionPreference
# = 'Stop' makes any Invoke-WebRequest HTTP error throw before the moves run.
$Tmp = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ("pe-" + [guid]::NewGuid()))
try {
  Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/enhance.sh"          -OutFile (Join-Path $Tmp 'enhance.sh')
  Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/tones.json"          -OutFile (Join-Path $Tmp 'tones.json')
  Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/commands/enhance.md" -OutFile (Join-Path $Tmp 'enhance.md')

  Move-Item -Force (Join-Path $Tmp 'enhance.sh') (Join-Path $DestScripts  'enhance.sh')
  Move-Item -Force (Join-Path $Tmp 'tones.json') (Join-Path $DestScripts  'tones.json')
  Move-Item -Force (Join-Path $Tmp 'enhance.md') (Join-Path $DestCommands 'enhance.md')
}
finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}

Write-Host @"
Installed:
  $DestCommands\enhance.md
  $DestScripts\enhance.sh
  $DestScripts\tones.json

Reload Claude Code (or start a new session) and try:
  /enhance write a function that reverses a string

Windows note: /enhance runs enhance.sh (a bash script). Claude Code runs it via
Git Bash, which provides bash + curl. You also need jq:
  winget install jqlang.jq

Make sure Ollama is running:
  ollama serve
  ollama pull llama3.2:3b
"@
