Set-Location $PSScriptRoot

# Clear any stale Git lock files
foreach ($lock in @(".git\HEAD.lock", ".git\index.lock", ".git\MERGE_HEAD.lock", ".git\COMMIT_EDITMSG.lock")) {
    $lockFile = Join-Path $PSScriptRoot $lock
    if (Test-Path $lockFile) {
        Write-Host "Removing stale lock: $lock" -ForegroundColor Yellow
        Remove-Item $lockFile -Force
    }
}

git config core.autocrlf true | Out-Null

# Reset any phantom staged deletions left by the Linux VM (files that appear
# deleted in the index but still exist on disk)
Write-Host "Resetting index to HEAD to clear stale staged deletions..." -ForegroundColor Cyan
git reset HEAD -- . 2>&1 | Out-Null

# Stage everything cleanly
Write-Host "Staging all changes..." -ForegroundColor Cyan
git add -A

$status = git status --porcelain
if (-not $status) {
    Write-Host "Nothing to commit - already up to date." -ForegroundColor Green
    git log --oneline -5
    Read-Host -Prompt "Press Enter to continue..."
    exit 0
}

$commitMessage = @"
feat: task editor improvements, table layouts for connections & mappings

Task scheduler
- Task-level target connection override (targetConnectionId field)
  Fallback chain: mapping profile target -> task override -> null
- Source directory override (sourceDirectory / source_file_path)
  Resolves Excel files as {dir}/{connection.file_name} for multi-slot tasks
  without cloning mapping profiles per customer
- Graceful handling of missing source files: abort task, log error to DB,
  finish as completed_with_errors — no unhandled exception / console overlay
- Edit modal widened to max-w-5xl with reduced padding
- Save Changes button added to modal header (two Save buttons total)
- Start date/time is now optional; blank saves task in Waiting with a
  far-future date so it never auto-triggers
- Mapping slot rows restructured: number + stacked select/label + button
  so delete button is always visible and never clipped
- First mapping slot can now be deleted when multiple slots are present
  (previously only slots 2+ had a delete button)

Connections page
- Replaced 3-column card grid with search bar + table layout
- Grouped by connection type when browsing; flat filtered list when searching
- Icon-only actions (Edit / Delete / Promote) with title tooltips
- Filtered / total counter in header when search is active

Mappings page
- Same search + table redesign as connections
- Columns: name + badges, mapping count, business object, updated date, actions
- ChevronRight affordance on every row; Use as Template text button for
  system profiles
"@

Write-Host "`nCommitting cumulative changes..." -ForegroundColor Cyan
git commit -m $commitMessage
if ($LASTEXITCODE -ne 0) {
    Write-Host "Commit failed." -ForegroundColor Red
    Read-Host -Prompt "Press Enter to continue..."
    exit 1
}

Write-Host "Pushing to origin..." -ForegroundColor Cyan
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "Push failed." -ForegroundColor Red
    Read-Host -Prompt "Press Enter to continue..."
    exit 1
}

Write-Host "`nDone! Last 5 commits:" -ForegroundColor Green
git log --oneline -5
Read-Host -Prompt "Press Enter to continue..."
