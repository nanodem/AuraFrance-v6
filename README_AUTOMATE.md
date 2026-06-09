Automation and deploy summary

1) Install and test locally:

```powershell
cd C:\path\to\AuraFrance
npm install
copy .env.example .env
# edit .env with real values
npm start
```

2) Persistent run with PM2:

```powershell
npm install -g pm2
pm2 start ecosystem.config.js --env production
pm2 save

# On Windows (install service)
npm install -g pm2-windows-service
pm2-service-install -n PM2
```

3) Deploy on Render: push to GitHub and create Web Service, set Build Command `npm install` and Start Command `npm start`, then add env vars in Render dashboard.

GitHub Actions: a workflow is included at `.github/workflows/deploy-render.yml` that triggers a Render deploy on push to `main`. You must add these GitHub secrets in the repository settings:

- `RENDER_SERVICE_ID` (the service id from Render, e.g., `srv-xxxxx`)
- `RENDER_API_KEY` (an API key from Render with deploy permissions)

