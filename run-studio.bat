@echo off
rem Мастерская одним двойным щелчком: обновления из git, закрытие старой копии, сборка движка, запуск, браузер.
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Мастерская СтройКрой - не закрывайте это окно
set "PORT=1420"

rem Сначала обновление. Весь блок читается сразу: git может заменить этот файл, и дальше выполняется уже новая версия.
if not "%~1"=="updated" (
  echo Получаю обновления мастерской...
  set "OLD="
  for /f %%h in ('git rev-parse HEAD 2^>nul') do set "OLD=%%h"
  git pull --ff-only
  if errorlevel 1 (
    echo.
    echo Мастерскую обновить не удалось: нет интернета или есть несохранённые правки.
    echo Запускаю версию, которая есть на компьютере.
    echo.
  )
  set "BASE="
  for /f "usebackq delims=" %%d in (`node -p "try{JSON.parse(require('fs').readFileSync('apps/studio/.studio-watch.json','utf8')).dir||''}catch(e){''}"`) do set "BASE=%%d"
  if defined BASE if exist "!BASE!\.git" (
    echo Получаю обновления базы алгоритмов и моделей...
    git -C "!BASE!" pull --ff-only
    if errorlevel 1 (
      echo.
      echo Базу обновить не удалось: нет интернета или есть несохранённые правки.
      echo Сделайте Commit и Sync в VS Code. Если не получится, напишите разработчику.
      echo.
    )
  )
  set "NEEDINSTALL="
  if not exist node_modules set "NEEDINSTALL=1"
  if defined OLD (
    git diff --quiet !OLD! HEAD -- package-lock.json
    if errorlevel 1 set "NEEDINSTALL=1"
  )
  if defined NEEDINSTALL (
    echo Устанавливаю новые компоненты...
    call npm install
  )
  call "%~f0" updated
  exit /b
)

rem Старая копия мастерской занимает адрес: закрываем её
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort %PORT% -ErrorAction SilentlyContinue | Where-Object { $_.RemotePort -eq 0 } | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

rem Значок на рабочем столе, чтобы не искать этот файл
powershell -NoProfile -Command "$p = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Мастерская СтройКрой.lnk'; if (-not (Test-Path $p)) { $s = (New-Object -ComObject WScript.Shell).CreateShortcut($p); $s.TargetPath = '%~f0'; $s.WorkingDirectory = '%~dp0'; $s.Save() }"

echo Собираю движок...
call npm run engine:build
if errorlevel 1 (
  echo.
  echo Сборка не удалась. Сделайте снимок этого окна и отправьте разработчику.
  pause
  exit /b 1
)
echo.
echo Запускаю мастерскую, сейчас откроется браузер. Это окно не закрывайте, пока работаете.
call npm run dev --workspace=apps/studio -- --open
echo.
echo Мастерская остановлена. Окно закроется само.
"%SystemRoot%\System32\timeout.exe" /t 30
