#requires -Version 7.0
# Load only the pipe helper; do not execute the upload entry point or read DPAPI.
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $repository 'scripts/upload-rotation-credentials.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Upload script syntax error' }
$definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Send-GitHubValue' }, $true)
. ([scriptblock]::Create($definition.Extent.Text))
$nodePath = (Get-Command node -ErrorAction Stop).Source
function Get-Command { param($Name) if ($Name -cne 'gh') { throw 'Unexpected command' }; return @{ Source = $nodePath } }
$work = Join-Path ([IO.Path]::GetTempPath()) ('shiki-rotation-upload-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($work)
try {
    $stub = Join-Path $work 'gh-fixture.mjs'
    # A child process checks that the value arrived as UTF-8 stdin, never as argv.
    [IO.File]::WriteAllText($stub, @'
import { readFileSync } from 'node:fs';
const value = readFileSync(0, 'utf8');
if (value !== 'fixture-private-Ж' || process.argv.includes(value)) process.exit(7);
console.log(value);
console.error(value);
process.exit(process.argv[2] === 'fail' ? 1 : 0);
'@, [Text.UTF8Encoding]::new($false))
    $output = @(Send-GitHubValue @($stub, 'success') 'fixture-private-Ж' *>&1)
    if ($output.Count -ne 0) { throw 'Child output must stay private' }
    $failed = $false
    try { Send-GitHubValue @($stub, 'fail') 'fixture-private-Ж' }
    catch {
        $failed = $true
        if ($_.Exception.Message.Contains('fixture-private')) { throw 'Child output leaked on failure' }
    }
    if (-not $failed) { throw 'Failed upload was accepted' }
    Write-Host 'PASS: credentials pipe preserves UTF-8, keeps values out of argv/output and fails closed (fake child only).'
} finally {
    $resolved = [IO.Path]::GetFullPath($work)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($resolved).StartsWith('shiki-rotation-upload-')) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
