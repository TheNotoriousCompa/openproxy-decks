# OpenProxy & Decks

Studio desktop **local-first** per creare, organizzare e stampare proxy e carte
custom. Importi i mazzi (Moxfield, Archidekt, testi, XML MPC Autofill), scegli
le stampe (Scryfall o community MPC), componi i fogli e generi PDF pronti da
tagliare. I tuoi dati restano sul disco: niente account, niente cloud.

## Scarica

Le build Windows (installer NSIS) sono nelle
[Release](https://github.com/TheNotoriousCompa/openproxy-decks/releases).
L'app si aggiorna da sola dalle release firmate: controllo all'avvio con
striscia discreta, oppure **Impostazioni → Aggiornamenti**.

Requisiti: Windows 10/11 con WebView2 (già incluso in Windows 11).

## Cosa c'è dentro

- **Studio di stampa**: fogli in flusso continuo (main → side → token), bleed,
  guide vettoriali, duplex, anteprima 1:1 e PDF multipagina.
- **DeckBuilder**: stesse liste dello Studio, raggruppamento per zona o tipo,
  statistiche (curva di mana, colori, prezzi), **bracket Commander calcolato**
  con Game Changer ufficiali, **mano di test**, link EDHREC.
- **Collezione**: proxy posseduti per stampa, uso in mainboard/orfane,
  “mancanti per mazzo”, artwork e tipo.
- **Import**: Moxfield pubblico (anche interi profili), Archidekt, testi,
  CSV/JSON/DEC, XML MPC Autofill, carte custom.
- **Fonti**: Scryfall e server MPC Autofill configurabile, con esclusione di
  drive/tag/set e catalogo stampe.

## Sviluppo

```bash
npm install
npm run tauri dev     # app desktop (Vite + Rust)
npm run dev           # solo frontend nel browser (senza filesystem/PDF)
npm run test          # test frontend
npm run lint          # tsc + eslint
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Stack: Tauri 2 (Rust), React 19 + TypeScript + Vite, Zustand, TanStack Query,
SQLite (rusqlite), image/pdf nativi.

Dati locali: `%APPDATA%\ProxyApp` (cartella storica mantenuta per compatibilità
con i progetti esistenti).

## Release e auto-update

Vedi [`RELEASING.md`](RELEASING.md). In breve: bump versione, tag `vX.Y.Z`,
push del tag → GitHub Actions compila, firma e pubblica installer +
`latest.json`. La chiave privata di firma vive solo nei secret GitHub.

## Licenza

**MIT** — vedi [`LICENSE`](LICENSE). Copyright (c) 2026 TheNotoriousCompa.
Puoi usare, modificare, distribuire e vendere il software, mantenendo il
copyright e la nota di licenza.
