#requires -Version 7.4
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
$jsonSource = New-Fixture "json-source-$suffix.zip" '{"manifest_version":3,"version":"0.2.1","permissions":["storage"],"browser_specific_settings":{"gecko":{"id":"test@example","update_url":"https://example.invalid/updates.json"}}}' $false
$reformatted = New-Fixture "json-format-$suffix.xpi" '{ "permissions": ["storage"], "browser_specific_settings": { "gecko": { "update_url": "https://example.invalid/updates.json", "id": "test@example" } }, "version": "0.2.1", "manifest_version": 3 }' $true
$jsonChanges = @(
    '{"manifest_version":3,"version":"0.2.1","permissions":["storage","tabs"],"browser_specific_settings":{"gecko":{"id":"test@example","update_url":"https://example.invalid/updates.json"}}}',
    '{"manifest_version":3,"version":"0.2.1","permissions":["storage"],"browser_specific_settings":{"gecko":{"id":"other@example","update_url":"https://example.invalid/updates.json"}}}',
    '{"manifest_version":3,"version":"0.2.2","permissions":["storage"],"browser_specific_settings":{"gecko":{"id":"test@example","update_url":"https://example.invalid/updates.json"}}}',
    '{"manifest_version":3,"version":"0.2.1","permissions":["storage"],"browser_specific_settings":{"gecko":{"id":"test@example","update_url":"https://other.invalid/updates.json"}}}'
)
$jsonFiles = @()
try {
    & (Join-Path $root 'scripts/verify-firefox-signed.ps1') -UnsignedPath $unsigned -SignedPath $signed
    foreach ($invalid in @($unsigned, $changed, $extra, $caseChanged)) {
        $rejected = $false
        try { & (Join-Path $root 'scripts/verify-firefox-signed.ps1') -UnsignedPath $unsigned -SignedPath $invalid }
        catch { $rejected = $true }
        if (-not $rejected) { throw 'Invalid signed package was accepted.' }
    }
    & (Join-Path $root 'scripts/verify-firefox-signed.ps1') -UnsignedPath $jsonSource -SignedPath $reformatted
    foreach ($change in $jsonChanges) {
        $invalid = New-Fixture ('json-invalid-' + [Guid]::NewGuid().ToString('N') + '.xpi') $change $true
        $jsonFiles += $invalid; $rejected = $false
        try { & (Join-Path $root 'scripts/verify-firefox-signed.ps1') -UnsignedPath $jsonSource -SignedPath $invalid }
        catch { $rejected = $true }
        if (-not $rejected) { throw 'Changed manifest fields were accepted.' }
    }
    Write-Output 'PASS: exact files and equivalent JSON accepted; changed files, names, permissions, ID, version and update URL rejected.'
} finally { foreach ($file in (@($unsigned, $signed, $changed, $extra, $caseChanged, $jsonSource, $reformatted) + $jsonFiles)) { Remove-Item -LiteralPath $file -Force } }
