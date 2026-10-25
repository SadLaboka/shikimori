#requires -Version 7.0
[CmdletBinding(DefaultParameterSetName = 'Inspect')]
param(
    [Parameter(ParameterSetName = 'Inspect')][switch]$DryRun,
    [Parameter(Mandatory, ParameterSetName = 'Publish')][switch]$Publish,
    [Parameter(Mandatory, ParameterSetName = 'Authorize')][switch]$Authorize,
    [Parameter(Mandatory, ParameterSetName = 'Refresh')][switch]$RefreshCredentials,
    [Parameter(ParameterSetName = 'Inspect')][string]$Baseline,
    [Parameter(ParameterSetName = 'Inspect')][Parameter(ParameterSetName = 'Publish')][switch]$CompactDiff,
    [Parameter(ParameterSetName = 'Inspect')][Parameter(ParameterSetName = 'Publish')][string]$ExpectedCssSha256,
    [string]$CssPath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'styles_optimized.css'),
    [string]$ConfigPath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'deploy.config.json')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Never emit HTTP headers, token responses, or raw exception objects.
$VerbosePreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'
$script:ApiRoot = 'https://shikimori.io'

function Read-PrivateValue([string]$Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    [System.Net.NetworkCredential]::new('', $secure).Password
}

function Confirm-Action([string]$Phrase) {
    Write-Host "Для подтверждения введите: $Phrase"
    if ((Read-Host 'Подтверждение') -cne $Phrase) { throw 'Действие отменено.' }
}

function Get-PrivateDirectory {
    if (-not $IsWindows) { throw 'Хранилище DPAPI поддерживается только в Windows.' }
    $directory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'ShikimoriCssDeploy'
    [void][IO.Directory]::CreateDirectory($directory)
    return $directory
}

function Save-Credentials($Credentials) {
    $directory = Get-PrivateDirectory
    $target = Join-Path $directory 'credentials.dpapi'
    $temporary = Join-Path $directory ([guid]::NewGuid().ToString() + '.tmp')
    try {
        $json = ConvertTo-Json -InputObject $Credentials -Depth 5 -Compress
        $encrypted = ConvertFrom-SecureString (ConvertTo-SecureString $json -AsPlainText -Force)
        [IO.File]::WriteAllText($temporary, $encrypted, [Text.UTF8Encoding]::new($false))
        [IO.File]::Move($temporary, $target, $true)
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
        $json = $null
    }
}

function Read-Credentials {
    $target = Join-Path (Get-PrivateDirectory) 'credentials.dpapi'
    if (-not (Test-Path -LiteralPath $target)) { throw 'Нет локальных credentials. Настройте OAuth отдельно через -Authorize.' }
    try {
        $secure = ConvertTo-SecureString ([IO.File]::ReadAllText($target))
        $json = [System.Net.NetworkCredential]::new('', $secure).Password
        return ConvertFrom-Json $json
    } catch { throw 'Не удалось прочитать credentials текущего пользователя Windows.' }
    finally { $json = $null }
}

function Request-Api([string]$Method, [string]$Path, $Body = $null, [string]$Token = '') {
    if ($Path -notmatch '^/(api/|oauth/token$)') { throw 'Недопустимый путь API.' }
    $headers = @{ 'User-Agent' = $script:Config.applicationName; 'Accept' = 'application/json' }
    if ($Token) { $headers.Authorization = 'Bearer ' + $Token }
    $request = @{
        Uri = $script:ApiRoot + $Path; Method = $Method; Headers = $headers
        TimeoutSec = 60; MaximumRedirection = 0; ErrorAction = 'Stop'
        Verbose = $false; Debug = $false
    }
    if ($null -ne $Body) {
        $request.ContentType = 'application/json; charset=utf-8'
        $request.Body = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $Body -Depth 6 -Compress))
    }
    try {
        # Sequential requests, below the published 5 rps / 90 rpm limits.
        Start-Sleep -Milliseconds 750
        return Invoke-RestMethod @request
    } catch {
        $status = 'network'
        if ($_.Exception.PSObject.Properties['Response'] -and $null -ne $_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
        }
        throw "Запрос $Method $Path не завершён успешно (HTTP $status). Секреты и ответ сервера скрыты."
    }
}

function Save-TokenResponse($Response, [string]$ClientSecret) {
    if (-not $Response.access_token -or -not $Response.refresh_token -or [long]$Response.expires_in -le 0) {
        throw 'Ответ OAuth не содержит ожидаемую пару токенов и срок действия.'
    }
    Save-Credentials @{
        accessToken = $Response.access_token; refreshToken = $Response.refresh_token
        clientSecret = $ClientSecret; clientId = $script:Config.clientId
        expiresAt = [DateTimeOffset]::UtcNow.AddSeconds([long]$Response.expires_in).ToString('o')
    }
    Write-Host 'Credentials сохранены локально с защитой DPAPI. Значения скрыты.'
}

function Invoke-Authorization {
    if (-not $script:Config.clientId -or -not $script:Config.redirectUri) {
        throw 'Заполните clientId и зарегистрированный redirectUri в конфигурации.'
    }
    # Manual browser redirect: no listener, cookies, or browser session extraction.
    $state = [guid]::NewGuid().ToString('N')
    $query = [ordered]@{
        client_id = $script:Config.clientId; redirect_uri = $script:Config.redirectUri
        response_type = 'code'; scope = $script:Config.scopes; state = $state
    }
    $parts = foreach ($key in $query.Keys) {
        [uri]::EscapeDataString($key) + '=' + [uri]::EscapeDataString([string]$query[$key])
    }
    Write-Host 'Откройте эту ссылку самостоятельно и проверьте запрашиваемые права:'
    Write-Host ($script:ApiRoot + '/oauth/authorize?' + ($parts -join '&'))
    Write-Host 'После согласия скопируйте полный адрес перенаправления; не отправляйте его в чат.'
    $redirect = Read-PrivateValue 'Полный адрес перенаправления (скрытый ввод)'
    try {
        $actual = [uri]$redirect
        $expected = [uri]$script:Config.redirectUri
        if ($actual.GetLeftPart([UriPartial]::Path) -cne $expected.GetLeftPart([UriPartial]::Path)) {
            throw 'Unexpected redirect'
        }
        $parameters = @{}
        foreach ($part in $actual.Query.TrimStart('?').Split('&')) {
            $pair = $part.Split('=', 2)
            if ($pair.Count -eq 2) { $parameters[[uri]::UnescapeDataString($pair[0])] = [uri]::UnescapeDataString($pair[1].Replace('+', ' ')) }
        }
        if ($parameters['state'] -cne $state -or -not $parameters['code']) { throw 'Invalid state or code' }
    } catch { throw 'Не удалось проверить адрес перенаправления, state и code. OAuth остановлен.' }
    $secret = Read-PrivateValue 'Client secret (скрытый ввод)'
    Confirm-Action 'AUTHORIZE'
    $response = Request-Api 'POST' '/oauth/token' @{
        grant_type = 'authorization_code'; client_id = $script:Config.clientId
        client_secret = $secret; code = $parameters['code']; redirect_uri = $script:Config.redirectUri
    }
    Save-TokenResponse $response $secret
}

function Read-Style([string]$Token) {
    $style = Request-Api 'GET' "/api/styles/$($script:Config.styleId)" $null $Token
    if ([long]$style.id -ne [long]$script:Config.styleId -or $style.owner_type -cne 'User' -or
        [long]$style.owner_id -ne [long]$script:Config.expectedUserId -or $null -eq $style.css) {
        throw 'Стиль не принадлежит ожидаемому аккаунту или ответ API неполон.'
    }
    return $style
}

function Save-Backup($Style) {
    $directory = Join-Path (Get-PrivateDirectory) 'backups'
    [void][IO.Directory]::CreateDirectory($directory)
    $stem = 'style-{0}-{1}-{2}' -f $Style.id, [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'), [guid]::NewGuid().ToString('N')
    $path = Join-Path $directory ($stem + '.css')
    [IO.File]::WriteAllText($path, [string]$Style.css, [Text.UTF8Encoding]::new($false))
    $metadata = @{
        id = $Style.id; ownerId = $Style.owner_id; savedAt = [DateTimeOffset]::UtcNow.ToString('o')
        sha256 = Get-TextHash ([string]$Style.css)
    }
    [IO.File]::WriteAllText((Join-Path $directory ($stem + '.json')), (ConvertTo-Json $metadata), [Text.UTF8Encoding]::new($false))
    Write-Host "Резервная копия: $path"
    return $path
}

function Get-TextHash([string]$Text) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { [BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text))).Replace('-', '') }
    finally { $algorithm.Dispose() }
}

function Get-DiffDirectory {
    return Join-Path (Split-Path $PSScriptRoot -Parent) '.preview/deploy'
}

function Show-CssDiff([string]$BeforePath, [string]$AfterPath) {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Для построчного diff необходим Git.' }
    $lines = @(& git --no-pager diff --no-index --no-ext-diff --no-textconv -- $BeforePath $AfterPath)
    if ($LASTEXITCODE -notin 0, 1) { throw 'Не удалось построить diff. Публикация запрещена.' }
    if (-not $CompactDiff) { $lines | ForEach-Object { Write-Host $_ }; return }
    if ($lines.Count -eq 0) { Write-Host 'Diff: CSS совпадает.'; return }
    # Keep the complete review artifact; shorten console output only.
    $directory = Get-DiffDirectory
    [void][IO.Directory]::CreateDirectory($directory)
    $artifact = Join-Path $directory ('css-' + [guid]::NewGuid().ToString('N') + '.diff')
    [IO.File]::WriteAllLines($artifact, [string[]]$lines, [Text.UTF8Encoding]::new($false))
    $body = @($lines | Where-Object { $_ -notmatch '^(diff --git |index |--- |\+\+\+ )' })
    $added = @($body | Where-Object { $_.StartsWith('+') }).Count
    $removed = @($body | Where-Object { $_.StartsWith('-') }).Count
    Write-Host "Diff: +$added / -$removed строк. Полный diff: $artifact"
    $preview = ($body | Select-Object -First 40) -join [Environment]::NewLine
    $truncated = $body.Count -gt 40 -or $preview.Length -gt 6000
    if ($preview.Length -gt 6000) { $preview = $preview.Substring(0, 6000) }
    Write-Host $preview
    if ($truncated) { Write-Host 'Вывод сокращён; перед подтверждением прочитайте полный diff.' }
}

function Invoke-Deployment {
    $encoding = [Text.UTF8Encoding]::new($false, $true)
    $css = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $CssPath).Path, $encoding)
    if ([string]::IsNullOrWhiteSpace($css)) { throw 'CSS пуст. Публикация пустого стиля запрещена.' }
    $cssHash = Get-TextHash $css
    if ($ExpectedCssSha256 -and ($ExpectedCssSha256 -notmatch '^[a-fA-F0-9]{64}$' -or $cssHash -ine $ExpectedCssSha256)) {
        throw 'CSS отличается от проверенного SHA256. Публикация остановлена до чтения credentials и запросов к API.'
    }
    $temporary = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString() + '.css')
    try {
        # Diff and PATCH always use this same in-memory snapshot, even if the source file changes.
        [IO.File]::WriteAllText($temporary, $css, [Text.UTF8Encoding]::new($false))
        if ($Baseline) {
            Show-CssDiff (Resolve-Path -LiteralPath $Baseline).Path $temporary
            Write-Host "OFFLINE DRY-RUN: запросов к API нет. SHA256: $cssHash"
            return
        }
        if ([long]$script:Config.styleId -le 0 -or [long]$script:Config.expectedUserId -le 0) {
            throw 'Укажите положительные styleId и expectedUserId. Это разные идентификаторы.'
        }
        $credentials = Read-Credentials
        if ($credentials.clientId -cne $script:Config.clientId) { throw 'clientId не совпадает с сохранёнными credentials.' }
        # ConvertFrom-Json may deserialize ISO timestamps as DateTime in newer PowerShell.
        $expiresAt = if ($credentials.expiresAt -is [DateTimeOffset]) {
            $credentials.expiresAt
        } elseif ($credentials.expiresAt -is [DateTime]) {
            [DateTimeOffset]::new($credentials.expiresAt)
        } else {
            [DateTimeOffset]::Parse([string]$credentials.expiresAt, [Globalization.CultureInfo]::InvariantCulture)
        }
        if ($expiresAt -le [DateTimeOffset]::UtcNow.AddMinutes(2)) {
            throw 'Токен истёк или скоро истечёт. Используйте отдельный режим -RefreshCredentials.'
        }
        $identity = Request-Api 'GET' '/api/users/whoami' $null $credentials.accessToken
        if ([long]$identity.id -ne [long]$script:Config.expectedUserId -or $identity.nickname -cne $script:Config.expectedNickname) {
            throw 'Авторизован другой аккаунт. Публикация запрещена.'
        }
        $before = Read-Style $credentials.accessToken
        $backup = Save-Backup $before
        Show-CssDiff $backup $temporary
        if ([string]$before.css -ceq $css) { Write-Host 'CSS уже совпадает. Публикация не нужна.'; return }
        if (-not $Publish) { Write-Host "DRY-RUN: публикации нет. SHA256: $cssHash"; return }
        Write-Host "Назначение: $($script:Config.expectedNickname), styleId=$($script:Config.styleId), SHA256=$cssHash"
        Confirm-Action "PUBLISH $($script:Config.expectedNickname) $($script:Config.styleId)"
        $latest = Read-Style $credentials.accessToken
        if ((Get-TextHash ([string]$latest.css)) -cne (Get-TextHash ([string]$before.css)) -or
            $latest.updated_at -cne $before.updated_at) {
            throw 'Стиль изменился после просмотра diff. Запустите проверку заново.'
        }
        try {
            $null = Request-Api 'PATCH' "/api/styles/$($script:Config.styleId)" @{ style = @{ css = $css } } $credentials.accessToken
        } catch {
            Write-Warning 'PATCH завершился ошибкой или таймаутом. Он мог быть применён; повторной отправки не будет.'
        }
        $after = Read-Style $credentials.accessToken
        if ([string]$after.css -cne $css) { throw 'Серверный CSS не совпадает с подготовленным. Резервная копия сохранена; автоматического отката нет.' }
        Write-Host "Проверено: сервер сохранил подготовленный CSS. SHA256: $cssHash"
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
    }
}

try {
    $script:Config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding utf8 | ConvertFrom-Json
    if (-not $Baseline -and [string]::IsNullOrWhiteSpace($script:Config.applicationName)) {
        throw 'Заполните applicationName: точное название OAuth-приложения для User-Agent.'
    }
    if ($Authorize) { Invoke-Authorization }
    elseif ($RefreshCredentials) {
        $credentials = Read-Credentials
        if ($credentials.clientId -cne $script:Config.clientId) { throw 'clientId не совпадает с сохранёнными credentials.' }
        Confirm-Action 'REFRESH'
        $response = Request-Api 'POST' '/oauth/token' @{
            grant_type = 'refresh_token'; client_id = $credentials.clientId
            client_secret = $credentials.clientSecret; refresh_token = $credentials.refreshToken
        }
        Save-TokenResponse $response $credentials.clientSecret
    } else { Invoke-Deployment }
} catch {
    # All HTTP errors are sanitized in Request-Api; do not print ErrorRecord/stack/request.
    Write-Host ('Остановлено: ' + $_.Exception.Message) -ForegroundColor Red
    throw 'Операция не завершена. Смотрите безопасное сообщение выше.'
}
