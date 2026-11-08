param([Parameter(Mandatory=$true)][string]$Token)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, WindowsBase, UIAutomationClient, UIAutomationTypes
$assemblies = @('System.dll', 'System.Core.dll', 'System.Windows.Forms.dll', 'System.Drawing.dll',
    [System.Windows.Rect].Assembly.Location,
    [System.Windows.Automation.AutomationElement].Assembly.Location,
    [System.Windows.Automation.AutomationIdentifier].Assembly.Location)
$source = Join-Path $PSScriptRoot 'chat-drop-windows.cs'

# Compile once at the TUI's privilege. The Explorer process receives these
# bytes over the private pipe and never launches a compiler of its own.
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('ComputerBridgeDrop-' + [Guid]::NewGuid().ToString('N') + '.dll')
try {
    Add-Type -Path $source -ReferencedAssemblies $assemblies -OutputAssembly $temporary
    $bytes = [IO.File]::ReadAllBytes($temporary)
} finally {
    [IO.File]::Delete($temporary)
}
[Reflection.Assembly]::Load($bytes) > $null
[ComputerBridgeDrop]::Track($Token, $bytes)
