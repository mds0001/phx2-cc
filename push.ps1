param(
    [string]$Message = ""
)

Set-Location $PSScriptRoot

# Clear any stale Git lock files
foreach ($lock in @(".git\HEAD.lock", ".git\index.lock", ".git\MERGE_HEAD.lock", ".git\COMMIT_EDITMSG.lock")) {
    $lockFile = Join-Path $PSScriptRoot $lock
    if (Test-Path $lockFile) {
        Write-Host "Removing stale lock: $lock" -ForegroundColor Yellow
        Remove-Item $lockFile -Force
    }
}

# Silence LF/CRLF warnings (Windows-only noise)
git config core.autocrlf true | Out-Null

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

# Check if there is anything to commit
$status = git status --porcelain
if (-not $status) {
    Write-Host "Nothing to commit - already up to date." -ForegroundColor Green
    git log --oneline -5
    Read-Host -Prompt "Press Enter to continue..."
    exit 0
}

Write-Host "Committing: $Message" -ForegroundColor Cyan
git commit -m $Message
if ($LASTEXITCODE -ne 0) {
    Write-Host "Commit failed." -ForegroundColor Red
    Read-Host -Prompt "Press Enter to continue..."
    exit 1
}

Write-Host "Pushing..." -ForegroundColor Cyan
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "Push failed." -ForegroundColor Red
    Read-Host -Prompt "Press Enter to continue..."
    exit 1
}

Write-Host "`nDone! Last 5 commits:" -ForegroundColor Green
git log --oneline -5
Read-Host -Prompt "Press Enter to continue..."
