@echo off
rem Fabrique un kit hors ligne de BiRTEC (pour Windows ou pour Linux), a copier sur une cle USB.
rem A lancer sur un PC connecte a Internet. Les questions sont posees dans cette fenetre.
chcp 65001 >nul
title Kit hors ligne de BiRTEC
setlocal
cd /d "%~dp0"

rem Version de Node utilisee par BiRTEC (aussi dans Preparer BiRTEC.bat)
set "NODE_VERSION=v24.21.0"
set "NODE="
if exist "%~dp0moteur\node\node.exe" set "NODE=%~dp0moteur\node\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\BiRTEC\moteur\node\node.exe" set "NODE=%LOCALAPPDATA%\BiRTEC\moteur\node\node.exe"
if not defined NODE if exist "%~dp0hors-ligne\node\node.exe" set "NODE=%~dp0hors-ligne\node\node.exe"
if defined NODE goto fabriquer

echo Téléchargement de Node %NODE_VERSION%...
set "DEST=%LOCALAPPDATA%\BiRTEC"
mkdir "%DEST%\moteur" 2>nul
curl.exe -L --fail -o "%DEST%\moteur\node.zip" "https://nodejs.org/dist/%NODE_VERSION%/node-%NODE_VERSION%-win-x64.zip" || goto erreur
tar.exe -xf "%DEST%\moteur\node.zip" -C "%DEST%\moteur" || goto erreur
move "%DEST%\moteur\node-%NODE_VERSION%-win-x64" "%DEST%\moteur\node" >nul || goto erreur
del "%DEST%\moteur\node.zip"
set "NODE=%DEST%\moteur\node\node.exe"

:fabriquer
"%NODE%" "%~dp0outils\fabriquer-kit-hors-ligne.js" --choisir %*
if errorlevel 1 goto erreur
pause
exit /b 0

:erreur
echo.
echo Le kit n'est pas terminé : voir le message ci-dessus. Relancez pour reprendre.
pause
exit /b 1
