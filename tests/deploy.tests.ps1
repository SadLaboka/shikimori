#requires -Version 7.0
# Standalone tests. No network, OAuth, or real credential store is used.
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$work = Join-Path ([IO.Path]::GetTempPath()) ('shiki-deploy-test-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($work)
try {
    $fixture = Join-Path $work 'fixture.css'
    [IO.File]::WriteAllText($fixture, '/* Проверка UTF-8 */ body { color: blue; }')
    . (Join-Path $repository 'scripts/deploy.ps1') -DryRun -Baseline $fixture -CssPath $fixture
    $transportFunction = ${function:Request-Api}
    $credentialReader = ${function:Read-Credentials}
    $diffFunction = ${function:Show-CssDiff}
    $Baseline = $null
    $CssPath = $fixture
    $script:Config = [pscustomobject]@{
        applicationName = 'Fixture'; expectedNickname = 'FixtureUser'; expectedUserId = 12
        styleId = 34; clientId = 'fixture-client'; redirectUri = ''; scopes = ''
    }
    function Get-PrivateDirectory { return $work }
    function Read-Credentials {
        $expiry = if ($script:scenario -eq 'date-expiry') {
            [DateTime]::UtcNow.AddHours(1)
        } else { [DateTimeOffset]::UtcNow.AddHours(1).ToString('o') }
        [pscustomobject]@{ accessToken = 'test-only'; clientId = 'fixture-client'; expiresAt = $expiry }
    }
    function Show-CssDiff([string]$BeforePath, [string]$AfterPath) {
        $script:reviewed = [IO.File]::ReadAllText($AfterPath)
    }
    function Confirm-Action([string]$Phrase) {
        $script:confirmed = $Phrase
        if ($script:scenario -eq 'cancel') { throw 'Cancelled' }
        if ($script:scenario -eq 'local-edit') { [IO.File]::WriteAllText($fixture, 'CHANGED AFTER REVIEW') }
    }
    function Request-Api([string]$Method, [string]$Path, $Body = $null, [string]$Token = '') {
        if ($Path -eq '/api/users/whoami') {
            $id = if ($script:scenario -eq 'wrong-user') { 99 } else { 12 }
            return [pscustomobject]@{ id = $id; nickname = 'FixtureUser' }
        }
        if ($Method -eq 'PATCH') {
            $script:patches++
            $script:sent = $Body.style.css
            if ($script:scenario -ne 'not-saved') { $script:remote = $Body.style.css }
            if ($script:scenario -eq 'timeout') { throw 'Simulated timeout' }
            return
        }
        if ($Path -eq '/api/styles/34' -and $Method -eq 'GET') {
            $script:reads++
            $css = if ($script:scenario -eq 'stale' -and $script:reads -eq 2) { 'CONCURRENT EDIT' } else { $script:remote }
            $owner = if ($script:scenario -eq 'wrong-owner') { 99 } else { 12 }
            return [pscustomobject]@{ id = 34; owner_type = 'User'; owner_id = $owner; css = $css; updated_at = 'fixture-time' }
        }
        throw 'Unexpected request'
    }
    $cases = @(
        @{ Name = 'dry-run'; Publish = $false; Patches = 0; Fail = $false },
        @{ Name = 'date-expiry'; Publish = $false; Patches = 0; Fail = $false },
        @{ Name = 'success'; Publish = $true; Patches = 1; Fail = $false },
        @{ Name = 'stale'; Publish = $true; Patches = 0; Fail = $true },
        @{ Name = 'cancel'; Publish = $true; Patches = 0; Fail = $true },
        @{ Name = 'wrong-user'; Publish = $true; Patches = 0; Fail = $true },
        @{ Name = 'wrong-owner'; Publish = $true; Patches = 0; Fail = $true },
        @{ Name = 'timeout'; Publish = $true; Patches = 1; Fail = $false },
        @{ Name = 'not-saved'; Publish = $true; Patches = 1; Fail = $true },
        @{ Name = 'local-edit'; Publish = $true; Patches = 1; Fail = $false }
    )
    foreach ($case in $cases) {
        [IO.File]::WriteAllText($fixture, '/* Проверка UTF-8 */ body { color: blue; }')
        $script:scenario = $case.Name
        $Publish = $case.Publish
        $script:patches = 0; $script:reads = 0; $script:remote = 'body { color: red; }'
        $script:reviewed = ''; $script:sent = ''; $script:confirmed = ''
        $failed = $false
        try { Invoke-Deployment } catch { $failed = $true }
        if ($failed -ne $case.Fail -or $script:patches -ne $case.Patches) { throw "FAILED: $($case.Name)" }
        if ($script:patches -gt 0 -and $script:sent -cne $script:reviewed) { throw 'PATCH differs from reviewed snapshot' }
        if ($script:patches -gt 0 -and $script:confirmed -cne 'PUBLISH FixtureUser 34') { throw 'Missing confirmation' }
        Write-Host "PASS: $($case.Name)"
    }
    $backupFiles = @(Get-ChildItem -LiteralPath (Join-Path $work 'backups') -Filter '*.css')
    if ($backupFiles.Count -lt 1 -or [IO.File]::ReadAllText($backupFiles[0].FullName) -cne 'body { color: red; }') {
        throw 'Backup does not preserve original CSS'
    }
    # Empty CSS must fail before any API request.
    [IO.File]::WriteAllText($fixture, ' ')
    $script:reads = 0
    $failed = $false
    try { Invoke-Deployment } catch { $failed = $true }
    if (-not $failed -or $script:reads -ne 0) { throw 'Empty CSS accepted' }
    Write-Host 'PASS: backup and empty CSS'
    # Hash pinning fails before credentials/network and does not replace confirmation.
    [IO.File]::WriteAllText($fixture, 'body { color: blue; }')
    $ExpectedCssSha256 = '0' * 64
    $script:reads = 0; $script:patches = 0
    $failed = $false
    try { Invoke-Deployment } catch { $failed = $_.Exception.Message.Contains('SHA256') }
    if (-not $failed -or $script:reads -ne 0 -or $script:patches -ne 0) { throw 'Hash mismatch was not blocked' }
    $ExpectedCssSha256 = (Get-TextHash ([IO.File]::ReadAllText($fixture))).ToLowerInvariant()
    $script:scenario = 'success'; $Publish = $true
    $script:remote = 'old CSS'; $script:reads = 0; $script:patches = 0
    $script:confirmed = ''; $script:reviewed = ''; $script:sent = ''
    Invoke-Deployment
    if ($script:patches -ne 1 -or $script:confirmed -cne 'PUBLISH FixtureUser 34' -or $script:sent -cne $script:reviewed) {
        throw 'Hash-pinned publication bypassed review/confirmation'
    }
    $ExpectedCssSha256 = $null
    Write-Host 'PASS: expected CSS hash guards the reviewed snapshot'
    # Large diff stays complete on disk while console output is bounded.
    function Get-DiffDirectory { return Join-Path $work 'diffs' }
    $beforeDiff = Join-Path $work 'before.css'
    $afterDiff = Join-Path $work 'after.css'
    [IO.File]::WriteAllText($beforeDiff, 'body { color: red; }')
    [IO.File]::WriteAllLines($afterDiff, [string[]]((1..150 | ForEach-Object { ".item-$_ { color: blue; }" }) + '.tail { content: "DIFF_TAIL_SENTINEL"; }'))
    $CompactDiff = $true
    $summary = @(& $diffFunction $beforeDiff $afterDiff 6>&1)
    $artifact = @(Get-ChildItem -LiteralPath (Join-Path $work 'diffs') -Filter '*.diff')
    if ($summary.Count -gt 45 -or ($summary -join "`n").Contains('DIFF_TAIL_SENTINEL') -or
        $artifact.Count -ne 1 -or -not [IO.File]::ReadAllText($artifact[0].FullName).Contains('DIFF_TAIL_SENTINEL')) {
        throw 'Compact diff is unbounded or its complete artifact is missing'
    }
    $fullDiffCharacters = [IO.File]::ReadAllText($artifact[0].FullName).Length
    $summaryCharacters = ($summary -join "`n").Length
    # A minified CSS line must not bypass the character bound.
    [IO.File]::WriteAllText($afterDiff, ('.large{--text:' + ('x' * 20000) + 'DIFF_TAIL_SENTINEL;}'))
    $longSummary = @(& $diffFunction $beforeDiff $afterDiff 6>&1)
    $artifacts = @(Get-ChildItem -LiteralPath (Join-Path $work 'diffs') -Filter '*.diff')
    if (($longSummary -join "`n").Length -gt 7000 -or ($longSummary -join "`n").Contains('DIFF_TAIL_SENTINEL') -or
        $artifacts.Count -ne 2 -or -not ($artifacts | Where-Object { [IO.File]::ReadAllText($_.FullName).Contains('x' * 20000) })) {
        throw 'Minified CSS bypassed compact output bounds or was truncated on disk'
    }
    Write-Host "PASS: compact diff ($fullDiffCharacters characters on disk, $summaryCharacters in console); minified-line guard"
    $CompactDiff = $false
    # Exercise actual HTTP wrapper without opening a network connection.
    function Start-Sleep { param($Milliseconds) }
    function Invoke-RestMethod {
        [CmdletBinding()]
        param($Uri, $Method, $Headers, $TimeoutSec, $MaximumRedirection, $ContentType, $Body)
        if ($script:transportFailure) { throw 'PRIVATE_SENTINEL_MUST_NOT_BE_PRINTED' }
        if ($Uri -cne 'https://shikimori.io/api/styles/34' -or $MaximumRedirection -ne 0 -or
            $Headers.Authorization -cne 'Bearer test-only' -or $ContentType -cne 'application/json; charset=utf-8') {
            throw 'Unexpected HTTP request shape'
        }
        $decoded = [Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json
        if ($decoded.style.css -cne '/* Кириллица */') { throw 'UTF-8 request corrupted' }
        return [pscustomobject]@{ ok = $true }
    }
    $script:transportFailure = $false
    $result = & $transportFunction 'PATCH' '/api/styles/34' @{ style = @{ css = '/* Кириллица */' } } 'test-only'
    if (-not $result.ok) { throw 'Transport failed' }
    $script:transportFailure = $true
    $safeMessage = ''
    try { & $transportFunction 'GET' '/api/styles/34' $null 'test-only' } catch { $safeMessage = $_.Exception.Message }
    if (-not $safeMessage.Contains('HTTP network') -or $safeMessage.Contains('PRIVATE_SENTINEL')) {
        throw 'Unsafe or missing HTTP error message'
    }
    Write-Host 'PASS: HTTP UTF-8, redirect policy, sanitized errors'
    # DPAPI round-trip with synthetic values in the disposable test directory.
    if ($IsWindows) {
        Save-Credentials @{ accessToken = 'fixture-access'; refreshToken = 'fixture-refresh'; clientSecret = 'fixture-secret' }
        $encrypted = [IO.File]::ReadAllText((Join-Path $work 'credentials.dpapi'))
        if ($encrypted.Contains('fixture-access') -or $encrypted.Contains('fixture-secret')) { throw 'Credentials stored in plaintext' }
        $restored = & $credentialReader
        if ($restored.accessToken -cne 'fixture-access' -or $restored.clientSecret -cne 'fixture-secret') { throw 'DPAPI round-trip failed' }
        Save-Credentials @{ accessToken = 'fixture-new'; refreshToken = 'fixture-new-refresh'; clientSecret = 'fixture-secret' }
        $restored = & $credentialReader
        if ($restored.accessToken -cne 'fixture-new') { throw 'Credential replacement failed' }
        Write-Host 'PASS: DPAPI encryption, decryption, atomic replacement (synthetic secrets)'
    }
    Write-Host 'All deployment tests passed (mock API only).'
} finally {
    # Delete only files created by this test in its verified temporary directory.
    $resolved = [IO.Path]::GetFullPath($work)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($resolved).StartsWith('shiki-deploy-test-')) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
