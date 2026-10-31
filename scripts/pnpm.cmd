@echo off
rem Local machine notes:
rem - The DSH pnpm shim runs under Electron; it must not be used for native builds.
rem - pnpm 11 needs Node >=22.13; prefer the installed Node 24.
rem - Clear the dead local proxy for package operations only.

set "AI_PANEL_NODE=E:\nodejs-v24.20.0\node.exe"
set "AI_PANEL_NODE_DIR=E:\nodejs-v24.20.0"
set "AI_PANEL_PNPM=E:\Deepseek_Harness\app\resources\app\node_modules\pnpm\bin\pnpm.cjs"
set "AI_PANEL_NODE_GYP=E:\nodejs-v24.20.0\node_modules\npm\node_modules\node-gyp\bin\node-gyp.js"

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
  set "PATH=%AI_PANEL_NODE_DIR%;%PATH%"
  if exist "%AI_PANEL_NODE_GYP%" set "npm_config_node_gyp=%AI_PANEL_NODE_GYP%"
  "%AI_PANEL_NODE%" "%AI_PANEL_PNPM%" %*
  exit /b %ERRORLEVEL%
)

call pnpm %*
exit /b %ERRORLEVEL%
