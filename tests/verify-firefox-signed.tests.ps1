#requires -Version 7.0
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$folder = Join-Path $root '.preview/firefox-signed-tests'
[void][IO.Directory]::CreateDirectory($folder)
function New-Fixture([string]$Name, [string]$Payload, [bool]$Signature, [bool]$Extra = $false, [string]$ManifestName = 'manifest.json') {
    $file = Join-Path $folder $Name
    $zip = [IO.Compression.ZipFile]::Open($file, [IO.Compression.ZipArchiveMode]::Create)
    try {
        $entries = @{ $ManifestName = $Payload }
        if ($Signature) { $entries['META-INF/mozilla.rsa'] = 'synthetic-signature-only' }
        if ($Extra) { $entries['unexpected.js'] = 'extra' }
        foreach ($entryName in $entries.Keys) {
            $stream = $zip.CreateEntry($entryName).Open()
            try { $value = [Text.Encoding]::UTF8.GetBytes($entries[$entryName]); $stream.Write($value, 0, $value.Length) }
            finally { $stream.Dispose() }
        }
    } finally { $zip.Dispose() }
    return $file
}
$suffix = [Guid]::NewGuid().ToString('N')
$unsigned = New-Fixture "unsigned-$suffix.zip" 'same' $false
$signed = New-Fixture "signed-$suffix.xpi" 'same' $true
$changed = New-Fixture "changed-$suffix.xpi" 'modified' $true
$extra = New-Fixture "extra-$suffix.xpi" 'same' $true $true
$caseChanged = New-Fixture "case-$suffix.xpi" 'same' $true $false 'MANIFEST.json'
try {
    & (Join-Path $root 'scripts/verify-firefox-signed.ps1') -UnsignedPath $unsigned -SignedPath $signed
    foreach ($invalid in @($unsigned, $changed, $extra, $caseChanged)) {
        $rejected = $false
        try { & (Join-Path $root 'scripts/verify-firefox-signed.ps1') -UnsignedPath $unsigned -SignedPath $invalid }
        catch { $rejected = $true }
        if (-not $rejected) { throw 'Invalid signed package was accepted.' }
    }
    Write-Output 'PASS: unchanged payload accepted; unsigned, modified, extra-file and renamed packages rejected.'
} finally { foreach ($file in @($unsigned, $signed, $changed, $extra, $caseChanged)) { Remove-Item -LiteralPath $file -Force } }
