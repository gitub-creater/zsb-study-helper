@echo off
:: One-time firewall setup - RIGHT CLICK and "Run as Administrator"
netsh advfirewall firewall delete rule name="ZSB Study Helper" >nul 2>&1
netsh advfirewall firewall add rule name="ZSB Study Helper" dir=in action=allow protocol=TCP localport=5173
if %errorlevel% == 0 (
    echo Firewall rule added successfully!
    echo Phones on the same WiFi can now access the app.
) else (
    echo Failed to add firewall rule. Please run as Administrator.
)
pause
