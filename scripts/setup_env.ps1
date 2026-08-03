# setup_env.ps1 — проверка и установка окружения курса «make it, teens» (Windows).
#
# Запуск (в терминале VS Code):
#   powershell -ExecutionPolicy Bypass -File scripts/setup_env.ps1
#
# Что делает: печатает ✅/❌ по каждому слою окружения и доставляет недостающее.
# git здесь НЕ ставится: он нужен раньше, чтобы склонировать этот репозиторий.
#
# Безопасно перезапускать: уже установленное пропускается.

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$script:missing = @()

function Show-Ok   { param($name, $ver) Write-Host "  OK   $name — $ver" -ForegroundColor Green }
function Show-Fail { param($name, $hint) Write-Host "  --   $name — не установлен" -ForegroundColor Red
                     Write-Host "       $hint" -ForegroundColor DarkGray
                     $script:missing += $name }

# $args — зарезервированное имя в PowerShell, параметр так называть нельзя:
# внутри функции оно остаётся автоматическим массивом и вызов уходит без аргументов.
function Get-Ver {
    param($cmd, $verArg)
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { return $null }
    try {
        $out = & $cmd $verArg 2>&1 | Select-Object -First 1
        if ($out) { return "$out".Trim() }
    } catch { }
    return $null
}

Write-Host ""
Write-Host "=== Окружение курса «make it, teens» ===" -ForegroundColor Cyan
Write-Host ""

# --- git (только проверка) ---
$v = Get-Ver 'git' '--version'
if ($v) { Show-Ok 'git' $v }
else    { Show-Fail 'git' 'Скачай с git-scm.com и установи, ничего не меняя. Потом запусти скрипт заново.' }

# --- winget (нужен для установки остального) ---
$hasWinget = $null -ne (Get-Command winget -ErrorAction SilentlyContinue)

# --- Python ---
$v = Get-Ver 'python' '--version'
if ($v -and $v -notmatch 'Microsoft Store') {
    Show-Ok 'python' $v
} else {
    Write-Host "  ..   python — ставлю..." -ForegroundColor Yellow
    if ($hasWinget) {
        winget install --id Python.Python.3.12 -e --source winget --accept-package-agreements --accept-source-agreements --scope user --silent | Out-Null
        $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                    [Environment]::GetEnvironmentVariable('Path','User')
        $v = Get-Ver 'python' '--version'
        if ($v) { Show-Ok 'python' $v }
        else    { Show-Fail 'python' 'Не поднялся. Открой НОВЫЙ терминал и запусти скрипт снова.' }
    } else {
        Show-Fail 'python' 'python.org -> Download. ВАЖНО: галочка "Add python.exe to PATH" на первом экране.'
    }
}

# --- Node.js ---
$v = Get-Ver 'node' '--version'
if ($v) {
    Show-Ok 'node' $v
} else {
    Write-Host "  ..   node — ставлю..." -ForegroundColor Yellow
    if ($hasWinget) {
        winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements --silent | Out-Null
        $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                    [Environment]::GetEnvironmentVariable('Path','User')
        $v = Get-Ver 'node' '--version'
        if ($v) { Show-Ok 'node' $v }
        else    { Show-Fail 'node' 'Не поднялся. Открой НОВЫЙ терминал и запусти скрипт снова.' }
    } else {
        Show-Fail 'node' 'nodejs.org -> зелёная кнопка LTS, ставь ничего не меняя.'
    }
}

# --- nano-banana-mcp (генератор картинок) ---
if (Get-Command npm -ErrorAction SilentlyContinue) {
    $installed = (npm ls -g nano-banana-mcp --depth=0 2>$null | Out-String)
    if ($installed -match 'nano-banana-mcp@') {
        $ver = ([regex]::Match($installed, 'nano-banana-mcp@([\d.]+)')).Groups[1].Value
        Show-Ok 'nano-banana-mcp' "v$ver"
    } else {
        Write-Host "  ..   nano-banana-mcp — ставлю..." -ForegroundColor Yellow
        npm install -g nano-banana-mcp 2>&1 | Out-Null
        $installed = (npm ls -g nano-banana-mcp --depth=0 2>$null | Out-String)
        if ($installed -match 'nano-banana-mcp@') { Show-Ok 'nano-banana-mcp' 'установлен' }
        else { Show-Fail 'nano-banana-mcp' 'npm install -g nano-banana-mcp — запусти вручную и покажи ошибку учителю.' }
    }
} else {
    Show-Fail 'nano-banana-mcp' 'Сначала нужен Node (npm идёт вместе с ним).'
}

# --- Python-зависимости курса ---
if ((Get-Command python -ErrorAction SilentlyContinue) -and (Test-Path 'requirements.txt')) {
    python -m pip install -q -r requirements.txt 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Show-Ok 'Pillow (requirements.txt)' 'установлен' }
    else { Write-Host "  ..   requirements.txt — не поставились, но курс это не блокирует" -ForegroundColor DarkYellow }
}

# --- Итог ---
Write-Host ""
if ($script:missing.Count -eq 0) {
    Write-Host "Всё готово. Можно работать." -ForegroundColor Green
} else {
    Write-Host ("Не хватает: " + ($script:missing -join ', ')) -ForegroundColor Red
    Write-Host "Подними руку — разберёмся вместе." -ForegroundColor Yellow
}
Write-Host ""
