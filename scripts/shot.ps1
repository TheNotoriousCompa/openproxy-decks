# Screenshot del frontend via Firefox headless (loop visivo senza Playwright).
param([string]$Url = "http://localhost:1420/", [string]$Out = "shot.png")
$ff = "C:\Program Files\Mozilla Firefox\firefox.exe"
if (-not (Test-Path -LiteralPath $ff)) { echo "FIREFOX-MISSING"; exit 2 }
$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
& $ff --new-instance --profile "C:\Users\win7\AppData\Local\Temp\opencode\ffshot-profile" --headless --screenshot $Out --window-size=1440,900 $Url 2>$null
if (Test-Path -LiteralPath $Out) { $f = Get-Item $Out; echo "SAVED:$Out $($f.Length)B" } else { echo "SHOT-FAILED"; exit 3 }
