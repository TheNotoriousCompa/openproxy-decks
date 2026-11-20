# Avvia OpenProxy & Decks (app desktop Tauri) â€” doppio click o tasto destro > Esegui con PowerShell.
# L'ambiente Rust/MSVC Ã¨ giÃ  fissato a livello utente (niente CFLAGS, toolchain 2019 pinnata);
# qui c'Ã¨ solo una sanificazione di sicurezza per la sessione.
$ErrorActionPreference = "Continue"
Remove-Item Env:\CFLAGS -ErrorAction SilentlyContinue
Remove-Item Env:\CXXFLAGS -ErrorAction SilentlyContinue
Set-Location -LiteralPath (Split-Path -Parent $MyInvocation.MyCommand.Path)
Write-Host "Avvio OpenProxy & Decks... (chiudi questa finestra per fermare l'app)"
npm run tauri dev
Write-Host "App terminata. Premi un tasto per chiudere."
[void][System.Console]::ReadKey($true)

