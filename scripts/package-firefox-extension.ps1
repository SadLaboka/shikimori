#requires -Version 7.0
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$source = Join-Path $root 'extensions/firefox'
$destination = Join-Path $root '.preview/firefox-extension'
$manifest = Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid extension version.' }
$files = @('manifest.json', 'background.mjs', 'bridge.js', 'avatar.js', 'avatar-hover.mjs', 'catalog.mjs', 'publisher.mjs', 'rate-limit.mjs',
    'popup.html', 'popup.mjs', 'popup.css', 'icons/schemes.svg', 'README.md')
[void][IO.Directory]::CreateDirectory($destination)
$archivePath = Join-Path $destination ('shikimori-schemes-' + $manifest.version + '.zip')
$stream = [IO.File]::Open($archivePath, [IO.FileMode]::Create, [IO.FileAccess]::ReadWrite)
try {
    $zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
    try {
        foreach ($relative in $files) {
            $file = Join-Path $source $relative
            if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing package file: $relative" }
            $entry = $zip.CreateEntry($relative, [IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime = [DateTimeOffset]::new(2026, 10, 29, 0, 0, 0, [TimeSpan]::Zero)
            $entryStream = $entry.Open()
            try {
                $bytes = [IO.File]::ReadAllBytes($file)
                $entryStream.Write($bytes, 0, $bytes.Length)
            } finally { $entryStream.Dispose() }
        }
    } finally { $zip.Dispose() }
} finally { $stream.Dispose() }
$xpiPath = [IO.Path]::ChangeExtension($archivePath, '.xpi')
[IO.File]::Copy($archivePath, $xpiPath, $true)
$check = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    $actual = @($check.Entries.FullName | Sort-Object)
    if (@(Compare-Object ($files | Sort-Object) $actual).Count) { throw 'Package allowlist mismatch.' }
} finally { $check.Dispose() }
Write-Output ('Package: ' + $archivePath)
Write-Output ('Unsigned XPI: ' + $xpiPath)
Write-Output ('SHA256: ' + (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant())
