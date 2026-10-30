#requires -Version 7.4
[CmdletBinding()]
param([Parameter(Mandatory)][string]$UnsignedPath, [Parameter(Mandatory)][string]$SignedPath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Read-Package([string]$PackagePath) {
    $archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $PackagePath).Path)
    try {
        $files = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
        $manifest = $null
        if ($archive.Entries.Count -gt 100) { throw 'Unexpected package entry count.' }
        foreach ($entry in $archive.Entries) {
            if ($entry.FullName.EndsWith('/')) { continue }
            if ($files.ContainsKey($entry.FullName) -or $entry.Length -gt 2000000) { throw 'Duplicate or oversized package entry.' }
            $stream = $entry.Open(); $buffer = [IO.MemoryStream]::new()
            try {
                $stream.CopyTo($buffer); $bytes = $buffer.ToArray()
                $files[$entry.FullName] = [Convert]::ToHexString([Security.Cryptography.SHA512]::HashData($bytes))
                if ($entry.FullName -ceq 'manifest.json') { $manifest = [Text.Encoding]::UTF8.GetString($bytes) }
            }
            finally { $stream.Dispose(); $buffer.Dispose() }
        }
        return @{ Files = $files; Manifest = $manifest }
    } finally { $archive.Dispose() }
}
$unsigned = Read-Package $UnsignedPath
$signed = Read-Package $SignedPath
if (-not (@($signed.Files.Keys) -cmatch '^META-INF/(mozilla\.rsa|cose\.sig)$')) { throw 'Mozilla signature files are missing.' }
foreach ($name in $unsigned.Files.Keys) {
    if (-not $signed.Files.ContainsKey($name)) { throw "Signed payload is missing: $name" }
    if ($unsigned.Files[$name] -eq $signed.Files[$name]) { continue }
    if ($name -ceq 'manifest.json') {
        # Permit JSON serialization changes only; all fields/values stay equal.
        $equivalent = $false
        try { $equivalent = [Text.Json.Nodes.JsonNode]::DeepEquals([Text.Json.Nodes.JsonNode]::Parse($unsigned.Manifest), [Text.Json.Nodes.JsonNode]::Parse($signed.Manifest)) }
        catch { $equivalent = $false }
        if ($equivalent) { Write-Output 'Mozilla reformatted manifest JSON; all fields and values are identical.'; continue }
    }
    throw "Signed payload differs: $name"
}
foreach ($name in $signed.Files.Keys) {
    if (-not $unsigned.Files.ContainsKey($name) -and $name -cnotmatch '^META-INF/[A-Za-z0-9._-]+$') { throw "Unexpected signed payload file: $name" }
}
Write-Output 'Signed extension payload matches the tested unsigned package.'
