#requires -Version 7.0
# Test the actual deploy entry point with disposable files and a fake HTTP transport.
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$work = Join-Path ([IO.Path]::GetTempPath()) ('shiki-rotation-deploy-' + [guid]::NewGuid().ToString('N'))
$global:ShikiRotationFixtureState = @{ scenario = ''; patches = 0; reads = 0; sent = ''; remote = '' }
$savedActions = $env:GITHUB_ACTIONS
$savedRepository = $env:GITHUB_REPOSITORY
[void][IO.Directory]::CreateDirectory($work)
try {
    $env:GITHUB_ACTIONS = 'true'
    $env:GITHUB_REPOSITORY = 'SadLaboka/shikimori'
    $cssPath = Join-Path $work 'candidate.css'
    $configPath = Join-Path $work 'config.local.json'
    $credentialsPath = Join-Path $work 'credentials.local.json'
    $contextPath = Join-Path $work 'context.local.json'
    $candidate = '/* fixture */ body { color: blue; }'
    $original = '/* fixture */ body { color: red; }'
    $hash = { param($text) [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($text))).ToLowerInvariant() }
    [IO.File]::WriteAllText($cssPath, $candidate)
    [IO.File]::WriteAllText($configPath, (ConvertTo-Json @{
        applicationName = 'Fixture'; expectedNickname = 'SadLaboka'; expectedUserId = 1408017
        styleId = 1343722; clientId = 'fixture-client'
    }))
    [IO.File]::WriteAllText($credentialsPath, (ConvertTo-Json @{
        clientId = 'fixture-client'; accessToken = 'fixture-access-PRIVATE'; expiresAt = [DateTimeOffset]::UtcNow.AddHours(1).ToString('o')
    }))
    function Start-Sleep { param($Milliseconds) }
    function Read-Host { throw 'Unexpected interactive confirmation' }
    function Invoke-RestMethod {
        [CmdletBinding()]
        param($Uri, $Method, $Headers, $TimeoutSec, $MaximumRedirection, $ContentType, $Body)
        if ($Headers.Authorization -cne 'Bearer fixture-access-PRIVATE' -or $MaximumRedirection -ne 0) { throw 'Unexpected transport' }
        if ($Uri -ceq 'https://shikimori.io/api/users/whoami') { return @{ id = 1408017; nickname = 'SadLaboka' } }
        if ($Uri -cne 'https://shikimori.io/api/styles/1343722') { throw 'Unexpected URL' }
        if ($Method -eq 'PATCH') {
            $global:ShikiRotationFixtureState.patches++
            $global:ShikiRotationFixtureState.sent = ([Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json).style.css
            if ($global:ShikiRotationFixtureState.scenario -ne 'not-saved') { $global:ShikiRotationFixtureState.remote = $global:ShikiRotationFixtureState.sent }
            if ($global:ShikiRotationFixtureState.scenario -eq 'timeout') { throw 'fixture-access-PRIVATE must not appear in logs' }
            return @{}
        }
        $global:ShikiRotationFixtureState.reads++
        $value = if ($global:ShikiRotationFixtureState.scenario -eq 'stale' -and $global:ShikiRotationFixtureState.reads -eq 2) { 'external edit' } else { $global:ShikiRotationFixtureState.remote }
        return @{ id = 1343722; owner_type = 'User'; owner_id = 1408017; css = $value; updated_at = '2026-11-04T10:00:00Z' }
    }
    foreach ($case in @(
        @{ Name = 'dry-run'; Publish = $false; Patches = 0; Fail = $false },
        @{ Name = 'publish'; Publish = $true; Patches = 1; Fail = $false },
        @{ Name = 'stale'; Publish = $true; Patches = 0; Fail = $true },
        @{ Name = 'changed-before-deploy'; Publish = $true; Patches = 0; Fail = $true },
        @{ Name = 'unarmed'; Publish = $true; Patches = 0; Fail = $true },
        @{ Name = 'expired-plan'; Publish = $true; Patches = 0; Fail = $true },
        @{ Name = 'wrong-repo'; Publish = $true; Patches = 0; Fail = $true },
        @{ Name = 'timeout'; Publish = $true; Patches = 1; Fail = $false },
        @{ Name = 'not-saved'; Publish = $true; Patches = 1; Fail = $true }
    )) {
        $global:ShikiRotationFixtureState.scenario = $case.Name
        $global:ShikiRotationFixtureState.patches = 0; $global:ShikiRotationFixtureState.reads = 0; $global:ShikiRotationFixtureState.sent = ''
        $global:ShikiRotationFixtureState.remote = if ($case.Name -eq 'changed-before-deploy') { 'external edit' } else { $original }
        $preparedAt = if ($case.Name -eq 'expired-plan') { [DateTimeOffset]::UtcNow.AddMinutes(-11) } else { [DateTimeOffset]::UtcNow }
        [IO.File]::WriteAllText($contextPath, (ConvertTo-Json @{
            version = 1; cssHash = (& $hash $candidate); beforeHash = (& $hash $original)
            beforeUpdatedAt = '2026-11-04T10:00:00Z'; preparedAt = $preparedAt.ToString('o')
            credentialsPath = $credentialsPath; backupDirectory = $work; armed = ($case.Name -ne 'unarmed')
        }))
        $env:GITHUB_REPOSITORY = if ($case.Name -eq 'wrong-repo') { 'Fixture/other' } else { 'SadLaboka/shikimori' }
        $parameters = @{ CssPath = $cssPath; ConfigPath = $configPath; AutomationContextPath = $contextPath; ExpectedCssSha256 = (& $hash $candidate) }
        if ($case.Publish) { $parameters.Publish = $true } else { $parameters.DryRun = $true }
        $failed = $false
        $log = @(& {
            try { & (Join-Path $repository 'scripts/deploy.ps1') @parameters }
            catch { $script:caseFailed = $true }
        } 6>&1 3>&1)
        $failed = $script:caseFailed -eq $true
        $script:caseFailed = $false
        if (($log -join "`n").Contains('fixture-access-PRIVATE')) { throw 'Secret appeared in output' }
        if ($failed -ne $case.Fail -or $global:ShikiRotationFixtureState.patches -ne $case.Patches) {
            $log | ForEach-Object { Write-Host $_ }
            throw "FAILED: $($case.Name) (failed=$failed; patches=$($global:ShikiRotationFixtureState.patches))"
        }
        if ($global:ShikiRotationFixtureState.patches -gt 0 -and $global:ShikiRotationFixtureState.sent -cne $candidate) { throw 'Wrong CSS snapshot sent' }
        Write-Host "PASS: automation $($case.Name)"
    }
    $backups = @(Get-ChildItem -LiteralPath (Join-Path $work 'backups') -Filter '*.css')
    if ($backups.Count -lt 1 -or [IO.File]::ReadAllText($backups[0].FullName) -cne $original) { throw 'Missing original CSS backup' }
    Write-Host 'All automated deployment tests passed (mock API only).'
} finally {
    Remove-Variable -Name ShikiRotationFixtureState -Scope Global -ErrorAction SilentlyContinue
    $env:GITHUB_ACTIONS = $savedActions
    $env:GITHUB_REPOSITORY = $savedRepository
    $resolved = [IO.Path]::GetFullPath($work)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($resolved).StartsWith('shiki-rotation-deploy-')) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
