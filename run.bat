@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 工业数字孪生大屏系统控制台

:MENU
cls
echo ==================================================
echo         工业自动化仓储 3D 数字孪生大屏
echo ==================================================
echo [1] 启动所有服务 (后台守护模式)
echo [2] 停止并释放容器
echo [3] 重新构建并热更新
echo [4] 查看实时日志 (Gateway / Telemetry)
echo [5] 打开孪生大屏浏览器
echo [6] 退出
echo ==================================================
set "choice="
set /p choice=请输入操作选项 [1-6]: 

if "%choice%"=="1" (
    docker compose up -d
    if errorlevel 1 (
        echo 启动失败，请检查 Docker 日志与 .env 令牌配置。
    ) else (
        echo 服务已启动，大屏地址: http://localhost:7000
    )
    pause
    goto MENU
)
if "%choice%"=="2" (
    docker compose down
    echo 服务已停止。
    pause
    goto MENU
)
if "%choice%"=="3" (
    docker compose up -d --build
    if errorlevel 1 (
        echo 构建或启动失败，请查看上方错误。
    ) else (
        echo 镜像重新编译并拉起成功。
    )
    pause
    goto MENU
)
if "%choice%"=="4" (
    docker compose logs -f --tail 50
    goto MENU
)
if "%choice%"=="5" (
    start http://localhost:7000
    goto MENU
)
if "%choice%"=="6" exit
goto MENU