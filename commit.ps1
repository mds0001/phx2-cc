# commit.ps1 — stage, commit, and push all changes
# Usage: .\commit.ps1 "Your commit message"
#        .\commit.ps1          (uses a default message)

param(
    [string]$Message = "chore: update scheduler and shell"
)

$repo = $PSScriptRoot

# Clear any stale git lock files
$locks = @("index.lock", "HEAD.lock", "MERGE_HEAD.lock", "CHERRY_PICK_HEAD.lock")
foreach ($lock in $locks) {
    $path = Join-Path $repo ".git\$lock"
    if (Test-Path $path) {
        Remove-Item $path -Force
        Write-Host "Removed stale lock: $lock" -ForegroundColor Yellow
    }
}

Set-Location $repo

git add -A
if ($LASTEXITCODE -ne 0) { Write-Host "git add failed" -ForegroundColor Red; exit 1 }

git commit -m $Message
if ($LASTEXITCODE -ne 0) { Write-Host "git commit failed" -ForegroundColor Red; exit 1 }

git push
if ($LASTEXITCODE -ne 0) { Write-Host "git push failed" -ForegroundColor Red; exit 1 }

Write-Host "`nPushed successfully." -ForegroundColor Green
