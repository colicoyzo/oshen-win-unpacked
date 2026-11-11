@echo off
chcp 65001 >nul
title o神套装-文件名修改器
cd /d "%~dp0"

set "ELECTRON_RUN_AS_NODE="

if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" "."
  exit /b 0
)

echo [错误] 未找到 Electron 依赖。
echo 请先在当前目录执行：npm install
pause
exit /b 1
