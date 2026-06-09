<#
Install PM2 and pm2-windows-service, then start the app as a Windows service.
Run PowerShell as Administrator.
#>

Write-Host "Installing pm2 and pm2-windows-service..." -ForegroundColor Cyan
npm install -g pm2
npm install -g pm2-windows-service

Write-Host "Starting app with pm2..." -ForegroundColor Cyan
if (Test-Path .\ecosystem.config.js) {
  pm2 start ecosystem.config.js --env production
} else {
  pm2 start server.js --name aura-france --env production
}

# Save pm2 process list and install service
pm2 save
Write-Host "Installing PM2 Windows service..." -ForegroundColor Cyan
pm2-service-install -n PM2

Write-Host "Service installed. Start the service via Windows Services (PM2) or reboot." -ForegroundColor Green
Write-Host "To view logs: pm2 logs" -ForegroundColor Green
