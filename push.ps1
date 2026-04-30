# push.ps1 — commit everything and push to main (triggers Vercel deploy)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

Write-Host "==> Staging all changes..."
git add -A

Write-Host ""
Write-Host "==> Changes to be committed:"
git diff --cached --stat

Write-Host ""
$msg = Read-Host "Commit message (leave blank for default)"
if ([string]::IsNullOrWhiteSpace($msg)) {
    $msg = "feat: add insight-invoice-probe diagnostic endpoint + invoice raw dump in _raw mode"
}

git commit -m $msg

Write-Host ""
Write-Host "==> Pushing to origin main..."
git push origin main

Write-Host ""
Write-Host "Done. Vercel will deploy automatically."
