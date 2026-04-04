@echo off
:: Force the terminal to treat this exact folder as the root
cd /d "%~dp0"

:: Launch the main cortex
pyw core/main.py

pause