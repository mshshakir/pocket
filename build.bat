@echo off
echo Building bundle.js...
npx esbuild src/app.js --bundle --format=iife --global-name=_PocketApp --outfile=bundle.js --log-level=warning
if %ERRORLEVEL% EQU 0 (
  echo Done! Reload index-v2.html in the browser.
) else (
  echo Build failed.
)
