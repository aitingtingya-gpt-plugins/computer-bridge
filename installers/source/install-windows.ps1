param(
    [string]$Server = "",
    [string]$Name = "",
    [string]$Python = "python",
    [switch]$NoBrowser
)
$ErrorActionPreference = "Stop"
if (-not $Server) { $Server = Read-Host "Server URL (https://your-domain, without /mcp)" }
Start-Transcript -Path (Join-Path $PSScriptRoot "install.log") -Append
try {
    $arguments = @((Join-Path $PSScriptRoot "install.py"), "--server", $Server)
    if ($Name) { $arguments += @("--name", $Name) }
    if ($NoBrowser) { $arguments += "--no-browser" }
    & $Python @arguments
    if ($LASTEXITCODE -ne 0) { throw "Computer Bridge installer exited with code $LASTEXITCODE" }
}
finally { Stop-Transcript }
