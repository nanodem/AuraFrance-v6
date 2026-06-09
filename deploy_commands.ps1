# تشغيل هذا السكربت محليًا لتحضير المستودع ورفع المشروع إلى GitHub
# عدّل المتغيرات `$GitUser` و `$Repo` قبل التشغيل

<#
Improved deploy helper:
- If GitHub CLI (`gh`) is installed and authenticated it will create the repo and push.
- Otherwise it will print the git commands to run manually.

Optional environment variables:
- GITHUB_REPO: repository name (default: AuraFrance-v6)
#>

$defaultRepo = 'AuraFrance-v6'
$repo = $env:GITHUB_REPO
if (-not $repo) { $repo = $defaultRepo }

Write-Host "Initializing local git repository..." -ForegroundColor Cyan
git init
git add .
git commit -m "Initial commit - AuraFrance v6" 2>$null
git branch -M main

$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh) {
  Write-Host "Detected GitHub CLI (gh). Attempting to determine username..." -ForegroundColor Cyan
  try {
    $user = gh api user --jq .login 2>$null
  } catch { $user = $null }
  if (-not $user) { $user = git config user.name }
  if (-not $user) {
    Write-Host "Could not detect GitHub username. Set environment variable GITHUB_REPO to 'username/repo' and re-run." -ForegroundColor Yellow
    Write-Host "Or install and authenticate GitHub CLI: https://cli.github.com/" -ForegroundColor Yellow
    exit 1
  }
  # If user provided full repo (user/repo) use it
  if ($repo -like '*/*') { $fullRepo = $repo } else { $fullRepo = "$user/$repo" }

  Write-Host "Creating repository $fullRepo via gh and pushing..." -ForegroundColor Green
  gh repo create $fullRepo --public --source=. --remote=origin --push --confirm
  Write-Host "Pushed to https://github.com/$fullRepo" -ForegroundColor Green
  Write-Host "Now create a Web Service on Render linked to this repo (branch: main) and add Render secrets as described in DEPLOY_RENDER.md" -ForegroundColor Green
} else {
  Write-Host "GitHub CLI not found. To push to GitHub, run these commands (replace <your-user>):" -ForegroundColor Yellow
  Write-Host "git remote add origin https://github.com/<your-user>/$repo.git"
  Write-Host "git push -u origin main"
  Write-Host "Then create a Web Service on Render linked to the repository (branch: main) and add Render secrets as described in DEPLOY_RENDER.md" -ForegroundColor Yellow
}
