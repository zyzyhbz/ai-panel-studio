@echo off
rem Local machine notes:
rem - The DSH pnpm shim runs under Electron; it must not be used for native builds.
rem - pnpm 11 needs Node >=22.13; prefer the installed Node 24.
rem - Clear the dead local proxy for package operations only.

set "AI_PANEL_NODE=E:\nodejs-v24.20.0\node.exe"
set "AI_PANEL_PNPM=E:\Deepseek_Harness\app\resources\app\node_modules\pnpm\bin\pnpm.cjs"

set HTTP_PROXY=
set HTTPS_PROXY=
set ALL_PROXY=
set http_proxy=
set https_proxy=
set all_proxy=
set NODE_USE_ENV_PROXY=0
set npm_config_runtime=
set npm_config_target=
set npm_config_disturl=

if exist "%AI_PANEL_NODE%" if exist "%AI_PANEL_PNPM%" (
  "%AI_PANEL_NODE%" "%AI_PANEL_PNPM%" %*
  exit /b %ERRORLEVEL%
)

call pnpm %*
exit /b %ERRORLEVEL%
