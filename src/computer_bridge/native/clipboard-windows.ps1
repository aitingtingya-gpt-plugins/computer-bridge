param([string]$Destination, [switch]$CopyText)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
if ($CopyText) {
    [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
    [System.Windows.Forms.Clipboard]::SetText([Console]::In.ReadToEnd())
    return
}
Add-Type -AssemblyName System.Drawing

if ([System.Windows.Forms.Clipboard]::ContainsFileDropList()) {
    $paths = @([System.Windows.Forms.Clipboard]::GetFileDropList())
    @{kind='files'; paths=$paths} | ConvertTo-Json -Compress
} elseif ([System.Windows.Forms.Clipboard]::ContainsImage()) {
    $image = [System.Windows.Forms.Clipboard]::GetImage()
    try { $image.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png) }
    finally { $image.Dispose() }
    @{kind='image'; paths=@($Destination)} | ConvertTo-Json -Compress
} elseif ([System.Windows.Forms.Clipboard]::ContainsText()) {
    @{kind='text'; text=[System.Windows.Forms.Clipboard]::GetText()} | ConvertTo-Json -Compress
} else {
    @{kind='empty'} | ConvertTo-Json -Compress
}
