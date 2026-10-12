@echo off
rem Prepare BiRTEC sous Windows (une seule fois) : installe Node dans le profil de l'utilisateur,
rem puis lance outils\preparer.js qui fait le reste (moteur d'IA, modele, raccourcis).
rem Tout est installe dans %LOCALAPPDATA%\BiRTEC : les programmes ne peuvent tourner que dans le profil.
chcp 65001 >nul
title Préparation de BiRTEC
setlocal

set "DEST=%LOCALAPPDATA%\BiRTEC"
rem Version de Node utilisee par BiRTEC (aussi dans preparer-birtec.sh)
set "NODE_VERSION=v24.21.0"

if exist "%DEST%\moteur\node\node.exe" goto preparer
rem Version hors ligne : Node est dans le kit, on le copie au lieu de le telecharger.
if not exist "%~dp0hors-ligne\node\node.exe" goto telecharger
echo Copie de Node depuis le kit hors ligne...
xcopy "%~dp0hors-ligne\node" "%DEST%\moteur\node\" /e /i /q /y >nul || goto erreur
goto preparer

:telecharger
echo Téléchargement de Node %NODE_VERSION%...
mkdir "%DEST%\moteur" 2>nul
curl.exe -L --fail -o "%DEST%\moteur\node.zip" "https://nodejs.org/dist/%NODE_VERSION%/node-%NODE_VERSION%-win-x64.zip" || goto erreur
tar.exe -xf "%DEST%\moteur\node.zip" -C "%DEST%\moteur" || goto erreur
move "%DEST%\moteur\node-%NODE_VERSION%-win-x64" "%DEST%\moteur\node" >nul || goto erreur
del "%DEST%\moteur\node.zip"

:preparer
"%DEST%\moteur\node\node.exe" "%~dp0outils\preparer.js" %*
if errorlevel 1 goto erreur
pause
exit /b 0

:erreur
echo.
echo La préparation n'est pas terminée : voir le message ci-dessus.
pause
exit /b 1
