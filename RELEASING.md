# Releasing (Windows)

## Una volta sola: chiavi e secret

La chiave di firma è già stata generata in
`%USERPROFILE%\.openproxy-decks\`:

- `updater.key` — chiave **privata** (mai nel repo)
- `updater.key.pub` — chiave pubblica (già in `src-tauri/tauri.conf.json`)
- `updater.key.password.txt` — password della chiave privata

Backup: salva `updater.key` **e** la password in un password manager. Se perdi
una delle due, le installazioni esistenti non potranno più aggiornarsi.

I secret del repository sono impostati con:

```powershell
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo TheNotoriousCompa/openproxy-decks < "$env:USERPROFILE\.openproxy-decks\updater.key"
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo TheNotoriousCompa/openproxy-decks
```

## Ogni release

1. Bumpa la versione in **tre** punti (devono coincidere):
   - `package.json` → `version`
   - `src-tauri/tauri.conf.json` → `version`
   - `src-tauri/Cargo.toml` → `[package] version`
2. Commit e tag:

   ```bash
   git add -A
   git commit -m "release: v0.2.0"
   git tag v0.2.0
   git push origin main --tags
   ```

3. GitHub Actions (`release.yml`) compila su `windows-latest`, firma gli
   artefatti, crea la release con installer NSIS e `latest.json`.
4. L'app installata trova l'update da
   `https://github.com/TheNotoriousCompa/openproxy-decks/releases/latest/download/latest.json`
   e lo propone all'avvio (o da Impostazioni → Aggiornamenti).

## Note

- Serve un installer **NSIS** (`--bundles nsis`): l'updater Windows usa quello.
- `bundle.createUpdaterArtifacts: true` genera `.sig` e `latest.json`.
- La prima release pubblicata è la base: le installazioni precedenti alla
  prima release firmata vanno reinstallate a mano.
- La firma Authenticode (SmartScreen) è separata: senza certificato Windows
  può mostrare un avviso al primo avvio.
