@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  Lyricly - telefondan erisim
echo  ---------------------------
echo  Telefon ve bilgisayar AYNI Wi-Fi aginda olmali.
echo  Telefonun tarayicisinda su adreslerden birini ac:
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do echo     http://%%b:5178
)
echo.
echo  Windows guvenlik duvari sorarsa "Ozel aglar" icin izin ver.
echo  Kapatmak icin bu pencereyi kapat.
echo.
python -m http.server 5178 --bind 0.0.0.0
