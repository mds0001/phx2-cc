param(
    [string]$Message = ""
)

Set-Location $PSScriptRoot

# Prompt for commit message if not provided
if (-not $Message) {
    $Message = Read-Host "Commit message"
    if (-not $Message) {
        Write-Host "Aborted: no commit message." -ForegroundColor Yellow
        exit 1
    }
}

Write-Host "`nStaging all changes..." -ForegroundColor Cyan
git add -A

Write-Host "Committing: $Message" -ForegroundColor Cyan
git commit -m $Message
if ($LASTEXITCODE -ne 0) {
    Write-Host "Commit failed." -ForegroundColor Red
    exit 1
}

Write-Host "Pushing..." -ForegroundColor Cyan
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "Push failed." -ForegroundColor Red
    exit 1
}

Write-Host "`nDone." -ForegroundColor Green
git log --oneline -5
Read-Host -Prompt "Press Enter to continue..."