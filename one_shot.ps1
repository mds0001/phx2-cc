Clear-Host

Write-Host "=== Ivanti Upload Launcher ==="

$TargetDirectory = "C:\Users\mdsto\projects\Grok\One Shot"

if (Test-Path $TargetDirectory) {
    Set-Location $TargetDirectory
    Write-Host "Changed to folder OK"
} else {
    Write-Host "Folder not found"
    pause
    exit
}

if (-not (Test-Path "upload_graphic_to_priceitem.py")) {
    Write-Host "Python script not found"
    pause
    exit
}

Write-Host "Running Python script now..."
Write-Host ""

python upload_graphic_to_priceitem.py

Write-Host ""
Write-Host "=== Finished ==="
pause