#requires -Version 7.0
$ErrorActionPreference = 'Stop'
$planPath = Join-Path $env:RUNNER_TEMP 'shikimori-rotation/plan.local.json'
$plan = Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json
if ($env:ROTATION_MODE -cne $plan.mode -or $plan.mode -notin @('dry-run', 'publish')) { throw 'Некорректный режим автосмены.' }
$parameters = @{
    CssPath = $plan.cssPath; ConfigPath = $plan.configPath
    ExpectedCssSha256 = $plan.cssHash; AutomationContextPath = $planPath; CompactDiff = $true
}
if ($plan.mode -eq 'publish') { $parameters.Publish = $true } else { $parameters.DryRun = $true }
& (Join-Path $PSScriptRoot 'deploy.ps1') @parameters
