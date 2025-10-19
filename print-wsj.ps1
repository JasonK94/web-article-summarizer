# Requires Chrome/Chromium on PATH. Edit $chrome if needed.
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$outDir = "$PSScriptRoot\pdf"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# Reuse your signed-in Chrome profile (so WSJ articles open as you)
# Change 'Default' to your profile folder name if needed.
$userDataDir = "$env:LOCALAPPDATA\Google\Chrome\User Data\Default"

Get-Content "$PSScriptRoot\urls.txt" | ForEach-Object {
  $url = $_.Trim()
  if ($url -eq "") { return }
  $safe = ($url -replace '[^\w\-]+','_').Substring(0,[Math]::Min(120, ($url -replace '[^\w\-]+','_').Length))
  $out = Join-Path $outDir "$safe.pdf"

  & $chrome `
    --headless=new `
    --user-data-dir="$userDataDir\.." `
    --profile-directory="Default" `
    --disable-gpu `
    --print-to-pdf="$out" `
    --print-to-pdf-no-header `
    --timeout=15000 `
    "$url"
}
Write-Host "Done. PDFs in: $outDir"
