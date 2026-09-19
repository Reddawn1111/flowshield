@echo off
title FLOWSHIELD 3D - Flood Simulation ^& Early Warning Command Center
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
echo ==============================================================================
echo  FLOWSHIELD 3D: Hydrodynamic Flood Simulation ^& Early Warning Dashboard
echo ==============================================================================
echo  Opening dashboard at http://localhost:5173 ...
start http://localhost:5173
call "C:\Program Files\nodejs\npm.cmd" run dev
