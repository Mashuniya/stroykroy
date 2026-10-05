@echo off
cd /d "%~dp0"
echo Собираю движок...
call npm run engine:build
if errorlevel 1 (
  echo.
  echo Сборка не удалась — смотрите ошибку выше.
  pause
  exit /b 1
)
echo.
echo Запускаю студию...
call npm run studio:dev
