@echo off
:: 한글 깨짐 방지 및 다국어 지원 코드페이지 지정
chcp 65001 > nul
title Git 수동 동기화 도구

:: PowerShell을 통해 동기화 스크립트 실행
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0git-sync.ps1"

echo.
echo ===================================================
echo   동기화 작업이 완료되었습니다. 
echo   창을 닫으려면 아무 키나 누르세요...
echo ===================================================
pause > nul
