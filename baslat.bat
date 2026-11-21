@echo off
cd /d "%~dp0"
start "" http://localhost:5178
python -m http.server 5178 --bind 127.0.0.1
