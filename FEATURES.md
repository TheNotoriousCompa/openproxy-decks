# FEATURES — OpenProxy & Decks

UI: sfondo nero, pannelli `#0A0A0A`/`#111111`, bordi `#262626`, testo chiaro,
unica accent (neutro chiaro). Niente gradienti/glass/neon/animazioni. Desktop-first.

## Aggiornamenti firmati (auto-updater)

Controllo all'avvio (silenzioso, solo app desktop) + striscia discreta sotto la
TopBar quando c'è una versione nuova: **Aggiorna** (download con progresso,
installazione, **Riavvia**) o **Più tardi**. Sezione **Impostazioni →
Aggiornamenti**: versione corrente, controllo manuale, note della release.
Endpoint: GitHub Releases (`latest.json`), update firmati con chiave minisign
(la privata vive solo nei secret GitHub). Release automatica su tag `v*`
(GitHub Actions, Windows NSIS). Vedi `RELEASING.md`.

## Projects

Nuovo · rinomina · duplica (carte + asset) · elimina · autosave 800 ms ·
salvataggio manifest · export/import `.proxyproject` · backup/restore · ricerca.
Ogni progetto: deck, carte, artwork, asset, impostazioni stampa, layout, cache metadata,
history (undo/redo), preset.
Card ariose in griglia (nome, voci, badge Attivo, azioni, checkbox).
**Export in blocco**: seleziona N progetti → un unico PDF (impostazioni Studio
correnti, moltiplicatore copie ×1/2/4, token in fondo, verifica misure inclusa).
**Pulisci token**: stessa selezione, toglie dal board Token le carte che non
sono token (una volta per progetto).

## DeckBuilder (vista mazzo della stessa lista)

Sezione accanto allo Studio sulla **stessa lista condivisa**: dashboard a due
colonne. A sinistra il mazzo, **sempre diviso per macro-zone** nell'ordine
Main Deck (comandante accorpato) → Sideboard → Maybeboard (con Considering) →
Tokens (Extra Deck e Custom solo se presenti), griglia a **5 carte per fila**
su schermi grandi, vista lista o testo; ricerca per nome e ordinamento dentro
le sezioni. A destra un'**isola sticky** con l'**anteprima grande della carta**
sotto il mouse (artwork, costo, tipo, testo oracolo on-demand, prezzo, badge
Game Changer) e le **statistiche compatte** (curva di mana, colori, terre,
CMC medio, prezzo, bracket Commander con scala 1–5). Ricerca carte,
**Consigliati EDHREC** e Sintassi vivono in una **scheda separata** ("Cerca"),
non più aperta di default e non a fianco del mazzo: risultati a **4 colonne**
con l'**anteprima grande nell'isola a destra** (artwork, tipo, testo oracolo,
prezzo), come nel DeckBuilder. Click sull'arte = aggiunta rapida al Main;
il **+** apre il menu **“Aggiungi a…”** con Main Deck, Sideboard, Commander,
Maybeboard, Tokens, Extra Deck, Considering e Custom.
Nei **Consigliati** c'è il filtro **“Solo carte dentro il bracket”**: usa il
bracket calcolato del mazzo (B2/B3/B4) e nasconde le Game Changer (e, sotto il
Bracket 4, il mass land denial), dichiarando quante carte nasconde.
**Board Token ripulito**: Moxfield ci aggancia anche i token-copia come carte
vere («The One Ring», «Glorious Gale»…): all'apertura del progetto le voci non
token (layout token/emblem o set di soli token) vengono tolte dal mazzo — una
volta per progetto, con Undo; se Scryfall non risolve una voce, la si lascia
dov'è (mai rimozioni a caso). Stessa pulizia prima di ogni export (singolo e
in blocco), così i PDF non dipendono dalla cache.
**Statistiche**: curva di mana, colori/identità, terre, CMC medio e prezzo
totale USD (dati Scryfall in cache, pesati per quantità). **Bracket Commander
calcolato** sulla mainboard (main + comandante): 0 Game Changer → B2, 1–3 →
B3, 4+ o mass land denial → B4, con scala 1–5, sintesi in una frase e nomi dei
segnali (B1/B5 e le combo a 2 carte non sono derivabili da una lista). **Game Changer ufficiali** dal flag
`game_changer` di Scryfall, con badge **(!)** rosso su tile e righe. **Mano di test**: 7
carte pescate dalla mainboard (comandante escluso), rimescola, mulligan
londinese (una carta in meno per mulligan) e pescata singola, con terre e CMC
medio della mano. Righe con stepper ±, segna-comandante
★, rimozione (con Undo) e **link EDHREC per carta** + pagina comandante
(`edhrec.com/route/?cc=<nome>` per le carte, `/commanders/<slug>` per il
comandante; solo link in uscita: EDHREC non espone API pubbliche). Click
sull'artwork = cambio stampa (stesso picker dello Studio), **tasto destro =
menu contestuale**: 🔍 ingrandimento alta risoluzione, sposta in zona (Main/Side/Commander/Maybeboard/…), segna
comandante, cambia stampa, EDHREC, rimuovi. Import con
**destinazione Studio/DeckBuilder** (selettore nel pannello
import: dopo un import bulk si apre la vista scelta).
Pannello destro **Ricerca stile Moxfield**: barra rapida ("Cerca e aggiungi…",
`/` per il focus, Invio per cercare) + link Ricerca avanzata · Consigliati ·
Sintassi. Tab **Consigliati**: **Top 100 per rank EDHREC** nei colori del
comandante (identità rispettata, incolori inclusi, terre in fondo, badge #rank
e quick-add). **Ricerca avanzata** in modale: nome, set, testo oracolo, tipo,
colori e identità (tutte/una qualsiasi), CMC/costo/forza/costituzione/fedeltà
con operatori, rarità, ordine e direzione — convertiti in sintassi Scryfall.
Preview rapida su hover, quick-add +.
Vista **Testo**: lista con MPC ID modificabile (Unisci/Sostituisci, copia,
ricarica) per incollare liste esterne con `(mpc:ID)`; chip `mpc:…` con copia
anche in griglia/lista.

## Studio solo-stampa (import sx · fogli centro · stampa dx, come proxxied.com/app)

Vista a tre colonne ridimensionabili, senza deck builder: import a sinistra
(ricerca + link Moxfield/Archidekt + decklist + MPC XML + custom upload),
**fogli di stampa al centro** in flusso continuo (ordine main → … → token,
comandante accorpato al main, pagine sempre piene: solo l'ultima può restare
corta) con **riepilogo copie per zona** in alto e **chip di zona semi-trasparenti**
sulla prima carta di ogni gruppo (solo informativi), celle con artwork vero
**cliccabili** (aprono il print-picker, scope singola copia) e **chip stat**
(DPI misurati con dot qualità, o DPI target), print builder a destra
(preset + personalizza + export), riepilogo voci/copie + Svuota/Decklist in fondo
alla colonna import.

## Import (tab Studio, sinistra)

Ricerca Scryfall + fallback offline · link Moxfield/Archidekt · **profilo Moxfield
(nickname o link): elenco deck pubblici → un progetto per deck selezionato** · decklist testo
con **MPC Art IDs** in coda (`(mpc:ID)`, `(ID)`, `{ID}` → provider mpc + URL Drive
diretto, niente ricerca) · file TXT/CSV/JSON/DEC · **file MPC Autofill XML**
(fronts/backs abbinati per slot) · carte custom (upload PNG/JPG/WEBP/GIF/BMP,
persistenti in `assets/`) · zone da header (`Sideboard`, `Commander`, …) ·
8 zone (main/side/commander/extra/maybe/**considering**/tokens/custom) ·
click cella foglio → print-picker (preset stampe community MPC full-art, tab
Scryfall, facce DFC indipendenti, preferiti, Apply to all; tile a risoluzione
media — mai thumb stirate; MPC: tutti i tipi CARD+TOKEN+CARDBACK, fuzzy di
ripiego, nessun tetto ai risultati) ·
**lingua preferita delle carte** (Impostazioni: Qualsiasi / Italiano / Inglese):
ricerca stampe, import artwork e prefetch provano la lingua scelta e, se la carta
non esiste, **ripiegano sull'inglese** dichiarandolo (niente errori fuorvianti);
ultima spiaggia per le liste tradotte il ricerca per nome fuzzy ·
**"Decklist"** (lista testuale con copia + download .txt + opzione con MPC IDs) ·
stato vuoto con CTA "Vai ai Progetti" (mai vicoli ciechi) ·
anteprime sempre via backend (`thumb_for` + `asset://`), badge diagnostico al posto del nero muto.

## Griglia e guide (allineate a MPC Autofill)

Layout: **margini indipendenti sui quattro lati** (con preset rapidi) e **spazio
tra righe/colonne separato**, griglia centrata nell'area utile. Bleed per lato
con preset rapidi (**default 1mm fisso**, rapido 1/8" per lo standard TCG): allarga le
celle, il taglio resta sul formato carta. **Il PDF impagina il flusso continuo**
con lo stesso ordine e lo stesso riempimento dell'anteprima (comandante accorpato
al main, mai pagina a sé; token per ultimi; flag **Considera carte Considering**
per includere o escludere quella zona da fogli e PDF): quello che vedi è quello
che esce, senza pagine quasi vuote in mezzo.

Guide: **segni d'angolo** verdi da 2mm con forma **Dentro / Croce / Fuori**
(i bracci partono dall'angolo e vanno verso l'interno), **riquadro carta** e
**linee di pagina** a tutta pagina attivabili a parte, sempre nere.
**Posizione** Dentro / Sul bordo / Fuori con compensazione automatica dello
spessore e **scostamento fine in mm**, lunghezza e spessore regolabili.
Riquadro, segni e linee seguono le stesse formule in anteprima e nel PDF.
L'anteprima mostra anche la **banda di bleed specchiata** come nel PDF.

Dorso: **facoltativo** (mai applicato da solo), usato solo dalle carte senza retro
e solo nei modi di stampa che stampano il retro.

## Projects

Lista paginata leggera (`list_project_summaries`, 20 per volta, conteggio deck via SQL)
per centinaia di progetti; dettaglio completo solo all'apertura.

## Import

Testo incollato · file TXT/CSV/JSON/DEC · formati `4 Nome [SET] num`, `(set) num`,
`SET num`, `SET-num` · **token `t:Nome` (Moxfield/Archidekt) → zona Tokens** ·
sezioni (`Sideboard`, `Commander`, …) e prefisso `SB:` · commenti `#`/`//` ·
quantità `4x` · duplicati consolidati con warning · arricchimento artwork automatico
(scaricato in `assets/` via backend) · **righe non riconosciute conservate
in `unknown`, mai eliminate** · serializzazione decklist.
Import Moxfield (link o profilo pubblico, senza login) e Archidekt: un progetto
per deck; il board Token viene ripulito dalle carte che non sono token (vedi
DeckBuilder).

## Cambio stampa e anteprime

Cambio stampa **istantaneo**: la scelta si applica subito e la finestra si chiude,
il download dell'immagine ad alta risoluzione prosegue in background con lo
**spinner pixel-art sopra la carta** interessata (nessun overlay a tutto schermo)
e **conferma in basso al centro** ("Stampa applicata", nome + copie) quando finisce.
Anteprime e chip DPI leggono solo l'header delle immagini: niente decodifiche
inutili da 14 MB per ogni cella.

## Fonti escluse (drive MPC, tag MPC, set MTG)

Le stampe che non piacciono si nascondono per tutte le carte, non solo per quella
aperta. Tre liste nello stesso pannello (**Esclusi** nel picker, e Impostazioni →
Fonti escluse), con ricerca, caselle e «Ripristina» per lista:

- **drive MPC** (es. «Trix Are For Scoot»): esclusi già nella richiesta al server
  (`sources: [[pk,false]]`, verificato live: i risultati sparivano);
- **tag MPC** (es. «AI Art», alias AI/Midjourney/GenAI — anche Pixel Art, Pop-Out,
  Sketch): filtro nativo `excludesTags`; valgono anche i sottotag perché ogni carta
  riporta la catena completa (`["AI Art","Art","Custom Art"]`);
- **set MTG** (codice Scryfall): filtrati a valle, e il set sparisce anche dal menu «Set».

Il bottone «escludi» su ogni tile esclude al volo la sua fonte (drive o set);
i chip in alto mostrano le escluse con la ✕ per riattivarle. «mostra escluse» le fa
ricomparire senza cambiare le preferenze (query distinta, già in cache al ritorno).
Le esclusioni sono una preferenza persistente (`app.settings`), non un filtro temporaneo.

## Collezione (proxy fisici posseduti)

Una voce per **stampa posseduta** (nome + set + numero: stesso nome in set
diversi sono voci distinte), quantità sommate per chiave. Persistente in
SQLite (`proxy.collection`, fallback localStorage nel browser).
Dal DeckBuilder: voce “Aggiungi alla collezione” nel menu tasto-destro,
bottone “Collezione +” con dialogo di conferma sui delta, badge “✓ collezione”
o “hai X/Y” su tile e righe. Tab **Collezione**: ricerca, ordinamento,
stepper quantità, vista “Mancanti per mazzo” con “aggiungi mancanti”.
Dopo ogni export (singolo e unito): “Vuoi aggiungere questo deck alla tua
collezione?” con anteprima — mai aggiunte silenziose.
Ogni riga mostra artwork (la stampa dai tuoi progetti, o Scryfall come
ripiego; solo display, mai cambiabile) e type line dalla cache condivisa
col DeckBuilder. Vista **griglia** (default, art grandi con badge costo mana
e prezzo) o **lista**; ordinamenti **Tipo** (default), **Prezzo**, **Costo
mana**, Nome, Quantità, Recenti. Click sull'artwork → **lightbox
tutto-schermo** con zoom (−/+, rotella, doppio-click), frecce/Esc per sfogliare.
Badge **In uso** (mazzi e copie in mainboard) o **Orfana**, con filtro
Tutte / In uso / Orfane per non ristampare doppioni.

## Print Builder (tab Studio, destra)

Preset layout (built-in + custom salvati su SQLite, validati Zod) ·
modificatori manuali raccolti nel collassabile "Personalizza" ·
anteprima a **fogli per zona** (label MAIN DECK / SIDEBOARD / COMMANDER / …) con
**artwork veri nelle celle** in layout di stampa reale (3×3 su A4 col bleed
default 1mm; rapido 1/8" per lo standard TCG) ·
preset carta (63×88 · YGO 59×86 · Poker · Bridge · Tarot · Custom) e pagina
(A3/A4/A5/A6/Letter/Legal/Tabloid/Custom) · portrait/landscape · margini/safe/spacing/bleed ·
layout Auto-Fit con coordinate e pagine · preview multipagina con zoom implicito ·
guide vettoriali (crop/corner/cut) · duplex (front/back/separate/long/short) ·
mirror/rotation/offset pronti nel layout · calibration via pagina di test (stampa pag.1).

## Qualità e upscale

Analisi per immagine: pixel sorgente, dimensioni fisiche, `DPI = px / pollici`,
DPI richiesti, pixel richiesti, fattore scala. Status GREEN/BLUE/YELLOW/ORANGE/RED
+ report pre-export (stats nel pannello destro, badge per carta).
Upscale locale CPU: Off (DPI nativi) / Ask / **Automatic (default)** / Sempre ·
skip se sufficiente · Lanczos3 HQ · mai ingrandimenti oltre il nativo con Off.
L'import usa la risoluzione piena Scryfall (`png`), la luminosità stampa è
regolabile (−50…+50%, le stampe casalinghe escono più scure: +5…+10%).

## Export

PDF multipagina nativo (misure precise, bleed, guide vettoriali, fronte/retro) ·
**composizione come proxxied.com** (algoritmo ripreso dal loro sorgente pubblico):
l'arte viene adattata alla CARTA con scala uniforme e ritaglio centrato (mai
stirata, mai ingrandita oltre la carta), poi attorno si costruisce la banda di
bleed **specchiata** (l'arte continua rispecchiata, angoli compresi) o a strisce
stirate quando il bordo carta è quasi tutto nero; pulizie di bordo come loro
(angoli chiari riempiti col colore vicino, quasi-neri portati a nero pieno) ·
**trasparenza appiattita su nero** (i PNG con angoli arrotondati trasparenti
legono come bordo carta, mai spicchi bianchi tra angolo e bleed) ·
preset carta 63×88 mm e **2.5×3.5 in (63.5×88.9 mm)** come la loro misura vera · **velocità**: resize con kernel SIMD (`fast_image_resize`, da ~21 s a ~2.5 s per
asset 1200 DPI), dimensioni lette dall'header invece di decodificare i file in
cache, identità asset dai metadati (niente SHA-256 di centinaia di MB), stream PDF
scritti a blocchi con capacità riservata, e **tempi per fase nel log** dell'app
(`[export] … elaborazione/impaginazione/PDF/scrittura`) ·
sempre in path assoluto sotto `exports/` del progetto (mai relativi alla CWD) ·
bottoni Apri PDF / Apri cartella · copie con sorgente illeggibile conteggiate
e riportate (mai silenziose) · immagini PNG/JPEG/WEBP · singola/multipla/ZIP ·
dedup asset · profili Minimum/Balanced(default)/High/Maximum · job queue con progress/cancel.
**Export unito multi-progetto**: barra di avanzamento reale dagli eventi del
backend (`job://progress`: elaborazione immagini → impaginazione → PDF), con
percentuale e fase; a fine export bottone **Apri cartella PDF**.
**Export globale e persistente**: la finestrella sticky in basso a sinistra
mostra l'avanzamento dell'export PDF (singolo o unito) anche cambiando tab o
vista; a fine lavoro offre **Apri PDF / Apri cartella** e l'eventuale errore.
Il prompt "aggiungi alla collezione" è globale, non legato alla vista.
Nelle Impostazioni la sezione **Cartelle e download** mostra percorso e
bottone **Apri** per PDF esportati e artwork del progetto attivo.

## Scorciatoie

`Ctrl/Cmd+Z` annulla · `Ctrl/Cmd+Shift+Z` o `Ctrl/Cmd+Y` ripeti · `Tab` naviga pannelli ·
frecce sui divisori ridimensionano · `Enter` conferma dialoghi ·
`Del` (DeckBuilder) rimuove la carta sotto il mouse, con undo.

## Impostazioni

DPI default · **lingua preferita delle carte (con ripiego inglese)** ·
pagina/carta · bleed · compressione · cache MB · server MPC Autofill
(URL + verifica handshake, tab stampe community full-art di default) ·
**fonti escluse** (drive MPC, tag MPC, set MTG) ·
**spazio disco** (artwork/cache/PDF/tmp/modelli/database + pulizia temporanei) ·
**cartelle e download** (PDF esportati e artwork del progetto attivo, con Apri) ·
**aggiornamenti** (versione, controllo manuale, note release) ·
clear image/processing/database cache · reset app.
