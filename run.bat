@echo off
title FLOWSHIELD — 3D Digital Twin + Forecast Command Center
cd /d "%~dp0"

echo ==============================================================================
echo  FLOWSHIELD: Unified 3D Digital Twin + Forecast Command Center
echo  Starting Streamlit Application at http://localhost:8501
echo ==============================================================================
echo.
python -m streamlit run flowshield/app.py
pause
