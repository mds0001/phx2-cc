# phx2 — GitHub Setup Script
# Run this once to initialize git and push to a new GitHub repo.
# Prerequisites: Git installed, GitHub CLI (gh) installed OR manual repo creation.

Set-Location -Path $PSScriptRoot

Write-Host ""
Write-Host "=== phx2 GitHub Setup ===" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Initialize git ────────────────────────────────────
if (Test-Path ".git") {
    Write-Host "[1] Git already initialized." -ForegroundColor Yellow
} else {
    git init
    git branch -m main
    Write-Host "[1] Git initialized." -ForegroundColor Green
}

# ── Step 2: Set identity (edit these if needed) ───────────────
git config user.name  "Michael Stout"
git config user.email "mdstout@outlook.com"
Write-Host "[2] Git identity set." -ForegroundColor Green

# ── Step 3: Stage and commit ──────────────────────────────────
git add .
git commit -m "Initial commit — phx2 task scheduler + Supabase"
Write-Host "[3] Initial commit created." -ForegroundColor Green

# ── Step 4: Create GitHub repo and push ──────────────────────
Write-Host ""
Write-Host "[4] Creating GitHub repository..." -ForegroundColor Cyan

# Check if GitHub CLI is available
if (Get-Command gh -ErrorAction SilentlyContinue) {
    Write-Host "    GitHub CLI found — creating repo automatically." -ForegroundColor Green
    gh repo create phx2 --private --source=. --remote=origin --push
    Write-Host ""
    Write-Host "Done! Your repo is live on GitHub." -ForegroundColor Green
    gh repo view --web
} else {
    Write-Host ""
    Write-Host "GitHub CLI (gh) not found. Do this manually:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  1. Go to https://github.com/new" -ForegroundColor White
    Write-Host "  2. Name it 'phx2', set to Private, do NOT init with README" -ForegroundColor White
    Write-Host "  3. Copy the repo URL (e.g. https://github.com/YOUR_USERNAME/phx2.git)" -ForegroundColor White
    Write-Host "  4. Run these commands:" -ForegroundColor White
    Write-Host ""
    Write-Host "     git remote add origin https://github.com/YOUR_USERNAME/phx2.git" -ForegroundColor Cyan
    Write-Host "     git push -u origin main" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Or install GitHub CLI from https://cli.github.com and re-run this script." -ForegroundColor Gray
}
