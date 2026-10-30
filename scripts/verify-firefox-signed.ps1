#requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][string]$UnsignedPath, [Parameter(Mandatory)][string]$SignedPath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Read-Package([string]$PackagePath) {
    $archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $PackagePath).Path)
    try {
        $files = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
        if ($archive.Entries.Count -gt 100) { throw 'Unexpected package entry count.' }
        foreach ($entry in $archive.Entries) {
            if ($entry.FullName.EndsWith('/')) { continue }
            if ($files.ContainsKey($entry.FullName) -or $entry.Length -gt 2000000) { throw 'Duplicate or oversized package entry.' }
            $stream = $entry.Open(); $buffer = [IO.MemoryStream]::new()
            try { $stream.CopyTo($buffer); $files[$entry.FullName] = [Convert]::ToHexString([Security.Cryptography.SHA512]::HashData($buffer.ToArray())) }
            finally { $stream.Dispose(); $buffer.Dispose() }
        }
        return $files
    } finally { $archive.Dispose() }
}
$unsigned = Read-Package $UnsignedPath
$signed = Read-Package $SignedPath
if (-not (@($signed.Keys) -cmatch '^META-INF/(mozilla\.rsa|cose\.sig)$')) { throw 'Mozilla signature files are missing.' }
foreach ($name in $unsigned.Keys) {
    if (-not $signed.ContainsKey($name) -or $unsigned[$name] -ne $signed[$name]) { throw "Signed payload differs: $name" }
}
foreach ($name in $signed.Keys) {
    if (-not $unsigned.ContainsKey($name) -and $name -cnotmatch '^META-INF/[A-Za-z0-9._-]+$') { throw "Unexpected signed payload file: $name" }
}
Write-Output 'Signed extension payload matches the tested unsigned package.'
