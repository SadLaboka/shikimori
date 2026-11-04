#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][switch]$Upload,
    [string]$ConfigPath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'rotation.local.json')
)
$ErrorActionPreference = 'Stop'
$VerbosePreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'

function Send-GitHubValue([string[]]$Arguments, [string]$Value) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = (Get-Command gh -ErrorAction Stop).Source
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardInputEncoding = [Text.UTF8Encoding]::new($false)
    $start.Environment['GH_DEBUG'] = ''
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::Start($start)
    try {
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.StandardInput.Write($Value)
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(60000)) { $process.Kill($true); throw 'GitHub CLI timeout' }
        $null = $stdout.GetAwaiter().GetResult()
        $null = $stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw 'GitHub CLI failed' }
    } finally { $process.Dispose() }
}

try {
    if (-not $Upload -or -not $IsWindows) { throw 'Нужны Windows и явный параметр -Upload.' }
    $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    if (-not $config.clientId -or -not $config.applicationName) { throw 'Заполните конфигурацию отдельного OAuth-приложения автосмены.' }
    Write-Host 'Будет обновлён только секрет автосмены и имя приложения в SadLaboka/shikimori. Расписание не включается.'
    if ((Read-Host 'Введите UPLOAD ROTATION') -cne 'UPLOAD ROTATION') { throw 'Отменено.' }
    $directory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'ShikimoriCssDeploy/rotation'
    $secure = ConvertTo-SecureString ([IO.File]::ReadAllText((Join-Path $directory 'credentials.dpapi')))
    $json = [System.Net.NetworkCredential]::new('', $secure).Password
    $credentials = ConvertFrom-Json $json
    if ($credentials.clientId -cne $config.clientId -or
        [DateTimeOffset]$credentials.expiresAt -le [DateTimeOffset]::UtcNow.AddMinutes(10)) { throw 'Проверьте профиль rotation и срок доступа.' }
    # Standard input only: no credentials in process arguments, console or local plaintext files.
    Send-GitHubValue @('secret', 'set', 'SHIKIMORI_ROTATION_CREDENTIALS', '--repo', 'SadLaboka/shikimori') $json
    Send-GitHubValue @('variable', 'set', 'SHIKIMORI_ROTATION_APPLICATION_NAME', '--repo', 'SadLaboka/shikimori') $config.applicationName
    Write-Host 'Секрет автосмены и имя OAuth-приложения сохранены. Расписание не включено; состояние не сброшено.'
} catch {
    # Crypto, parsing and child-process exceptions can contain input. Keep them private.
    throw 'Загрузка остановлена. Проверьте отдельный профиль rotation, конфигурацию и вход gh. Подробности с секретами скрыты.'
} finally {
    $json = $null; $credentials = $null; $secure = $null
}
