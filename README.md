



# Pitchtory ⚽

**Pitch + Victory.** Il football manager definitivo in formato PWA. Tutto client-side: nessun account, nessun server — la carriera vive sul tuo dispositivo.

> Stato: G1 — La Piramide completa (v0.15.2): due leghe con promozioni e retrocessioni, Coppa Nazionale Trofeo Bellandi a sedici infrasettimanale con rigori giocati, squalifiche, rosa leggibile su mobile — più motore QTE, mercato, abilità, osservatorio, identità «Notte di Divisione d'Onore» e PWA completa. Prossima: G2 — Banco e Lavagnetta.

## Sviluppo

    npm install
    npm run dev       # http://localhost:5173
    npm run build     # build di produzione in dist/
    npm run preview   # anteprima della build

## Cosa c'è nella F3

Motore di simulazione tick-based con gol Poisson guidati dalla forza delle squadre (miglior XI, morale, fattore campo), marcatori e assist, cronaca con occasioni e cartellini. Partita della propria squadra in replay live alla velocità scelta (1-2 / 5-6 / 7-8 minuti), con "salta al risultato" prima del fischio d'inizio.

**QTE nei momenti chiave**: pool di 7 momenti possibili — rigore da giocare, uno contro uno col portiere, contropiede a favore, punizione dal limite, corner finale, contropiede da fermare, corner da difendere nel finale (attivo solo con un risultato da proteggere). 3 opzioni, timer 10 secondi, scelta prudente automatica allo scadere. L'esito di ogni opzione è precomputato deterministicamente: lo stesso QTE dà sempre lo stesso esito, niente reroll ricaricando la pagina.

**Sostituzioni in corsa**: massimo 3 cambi dal vivo, pannello con le barre di stamina di chi è in campo. Chi entra parte fresco (97%) e può cambiare la partita — gol, assist o occasione — sempre con esito deterministico dal seed. I giocatori coinvolti in un momento chiave in arrivo non sono sostituibili.

**Infortuni**: possono colpire chiunque, in ogni partita (anche nei club AI, per equità). Se ne accorghi in diretta: cambio obbligato se hai cambi disponibili, altrimenti si resta in dieci. La gravità (1-5 giornate) è nel seed della partita.

**Statistiche e progressione**: presenze, minuti e gol di ogni giocatore (colonne PG e G nella tab Rosa). A fine stagione chi ha giocato migliora di più: crescita = margine sul potenziale × età × minuti giocati. I giovani della Primavera non vedono il campo, quindi crescono in base al livello del settore giovanile. Dopo i 30 anni arriva il declino. Tutto deterministico dal seed della carriera.

**Fine stagione**: titolo assegnato alla prima in classifica, trofeo salvato nella carriera, riepilogo con chi è cresciuto e chi ha pagato dazio, invecchiamento, promozione dei Primavera che compiono 19 anni, calendario nuovo. La stessa carriera, lo stesso futuro: le stagioni successive sono deterministiche quanto la prima.

## Attributi e schede giocatore (F3.5)

Ogni calciatore ha **6 attributi in scala 1-20** — Velocità, Tiro, Passaggio, Dribbling, Contrasto e Fisico per gli uomini di movimento; Riflessi, Tuffi, Presa, Posizione, Rinvii e Velocità per i portieri. L'**OVR non esiste più come numero a sé: è derivato**, media pesata per ruolo (il Contrasto pesa il 30% per un difensore, il Tiro il 30% per un attaccante). Tappa un nome nella Rosa e si apre la scheda: barre degli attributi, contratto, morale, statistiche di stagione e — per la Primavera — la stima del potenziale da parte del tuo staff.

**Crescita attributo per attributo**: le percentuali di progressione muovono i singoli attributi, non un OVR astratto. Chi gioca di più allena gli attributi che contano per il suo ruolo; il declino over-30 colpisce prima Velocità e Fisico — il 33enne che perde lo scatto, come nella vita. Le carriere esistenti vengono migrate al volo al primo caricamento, deterministica dal seed e centrata sull'OVR attuale: la tua stagione continua identica.

## Mercato (F4)

Il calcio si compra e si vende, a finestre: **estiva** (prima della giornata 1) e **invernale** (tra la 19ª e la 20ª). Fuori da quelle, la tab Mercato racconta solo quando si riapre.

**Comprare**: lista di tutta la lega con filtri per ruolo, ricerca per nome e ordinamenti (OVR, prezzo, età). Ogni club ha il suo **prezzo richiesto**: il valore di mercato più la riluttanza — i top della rosa costano, i contratti in scadenza si svenano, i prospetti si pagano sopra prezzo. Offri quello che vuoi: sotto l'80% del richiesto nemmeno rispondono; tra l'80% e il pieno contano il prezzo pieno; al pieno stringono la mano. Una trattativa, non un'asta — sempre deterministica: stessa offerta, stessa risposta.

**Vendere**: metti un senior sul mercato e chiedi offerte: i club AI a cui manca proprio quel ruolo si fanno avanti (o no). Chi offre di più si prende il giocatore, il budget si aggiusta, la media OVR pure.

**La lega vive**: a fine stagione anche i club AI si rinforzano tra loro con un loro mercato estivo. Guardie serie: rosa minima 16 senior per vendere, massima 30 per comprare. La Primavera non si tocca: cresce in silenzio.

## Abilità speciali e osservatori (F5)

**Dieci abilità con la rarità nel seed**: ogni calciatore può averne una — il 9% una comune, il 3% una rara, lo 0,8% una leggendaria, con massimo **3 Fuoriclasse per lega**. Bomber d'area, Falcata, Muro di Gomma e Maratoneta (comuni); Ghiaccio nelle vene, Regista, Capitano, Specialista di punizioni e Falco aereo (rare); Fuoriclasse (leggendaria). Assegnazione deterministica dal seed: stessa lega, stessi campioni. Le carriere esistenti migrano al primo caricamento, senza toccare la rosa.

**Effetti concreti in campo**: il Bomber d'area segna di più, il Regista serve gli assist, il Capitano e il Fuoriclasse alzano la forza della squadra. Ghiaccio nelle vene non sbaglia un rigore, lo Specialista prende la punizione dal limite, il Falco aereo sale sul corner finale, il Muro di Gomma respinge i tiri, la Falcata allunga il contropiede, il Maratoneta consuma meno stamina. Nei prompt dei QTE si leggono i nomi: chi ha l'abilità giusta, nel momento giusto, si vede.

**Osservatorio**: la stima del potenziale della Primavera passa dallo staff alla **rete di osservatori** — livelli 1-5 con margine di errore da ±10 a ±2 OVR, **focus per ruolo** (portieri, difensori, centrocampisti, attaccanti) che restringe il dubbio, potenziamenti a budget (da 2M a 15M). Ogni potenziamento rilegge la Primavera: le stime cambiano, la verità no. Chi ha un'abilità porta il **✦** in rosa e nel mercato, e il valore di mercato premia i campioni.

## Notte di Divisione d'Onore (restyle v0.12.0)

Un match serale sotto i riflettori, in un campetto che nessuno conosce. Identità dedicata al gioco, non ereditata dallo studio:

- **Palette**: verde notte `#050d08`/`#0a1710` (fondo e superfici) · oro da riflettore `#efbf4e` (il colore del legacy: gol, trofei, ✦ leggendarie, tab attivo) · erba illuminata `#2fb56e`/`#47d489` (azioni e stati positivi) · bianco gesso `#f2f6f1` (testo) · rosso cartellino per il resto.
- **Tipografia**: Oswald per tabellone, wordmark, nomi e punteggi (classe `.scoreboard`, numeri tabulari), Archivo per il testo — via `@fontsource`, così la PWA resta offline-friendly.
- **Texture**: grana leggera da notte di stadio sopra tutto (`body::before`), scrollbar discreta, selezione oro.
- **Motion**: `goal-flash` (bagliore oro sul tabellino a ogni gol e sul punteggio finale), `slide-in` per gli eventi della cronaca, `fade-up` per card e pannelli, `urgent` per gli ultimi 3 secondi dei QTE e il caricamento. Tutto disattivato con `prefers-reduced-motion`.
- **Strategy**: la scala `pitch` è stata ridefinita per intero e `slate`/`teal`/`amber` rimappati sui nuovi toni — l'intera app ha cambiato pelle senza riscrivere una riga di logica.
- **Logo kit**: crest tondo (PITCHTORY su arco, EST. 2026, stella oro, palla gesso), variante monocroma, wordmark, icona maskable e favicon in `src/assets/`; anteprima ed export PNG da `logokit.html` con `npm run dev` + `/logokit.html`. Le PNG si caricano a mano nel repo: il push binario via API corrompe le immagini.
## PWA (F6)

Pitchtory è una PWA completa secondo lo standard Little Elsewhere:

- **Manifest**: `id` e `start_url`/`scope` relativi (multi-hosting GitHub Pages + Cloudflare), icone PNG 192/512 `any` **e** maskable separate + SVG, `shortcuts` (Rosa e Mercato, gestiti via `?tab=`), `screenshots` wide 1280×720 e narrow 540×960, `lang: it`.
- **Service worker**: precache resiliente (una risorsa essenziale sola: la shell; tutto il resto fallisce in silenzio), navigazioni network-first con fallback alla shell offline, asset con hash cache-first, evizione delle cache vecchie in `activate`. Il nome cache porta un **timbro di build automatico** (`__SW_BUILD__` sostituito da un plugin Vite a ogni `npm run build`): mai bump manuali.
- **Aggiornamento controllato**: quando arriva una versione nuova, un banner propone «Aggiorna» — mai `skipWaiting` silenzioso. La registrazione avviene solo in build, mai in dev.
- **Installazione**: `beforeinstallprompt` + pulsante «Installa», istruzioni iOS/iPadOS (`maxTouchPoints > 1` compreso) mostrate una volta sola, `apple-touch-icon` e metadati apple-web-app, prompt nascosto se già standalone.
- **Sicurezza** (`_headers`, Cloudflare Pages): CSP in **Report-Only** da validare su deploy di test prima di attivarla (nessuna risorsa esterna: tutto `self` + `data:` per la grana), HSTS 2 anni con preload, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, asset hashati immutabili, `sw.js` mai in cache.
- **Social**: `og:image` 1200×630 con `og:image:alt`, `twitter:card summary_large_image`, JSON-LD `SoftwareApplication` (offers price 0, niente rating auto-attribuito). L'app è l'unica pagina del prodotto: indicizzata, senza cannibalizzazione.
- **PNG a mano**: il push binario via API corrompe le immagini, quindi icone PNG (192/512 any + maskable, apple-touch 180) ed `og.png` si esportano da `logokit.html` e si caricano via web in `public/icons/` e `public/`; gli screenshot veri della app (1280×720 e 540×960) vanno in `public/screenshots/`.
- **Lingua**: il gioco è pensato in italiano (lega fittizia, tono ironico): manifest e contenuti in IT, niente toggle EN.
## La Piramide (G1)

Due serie, una coppa, e le conseguenze che vengono con entrambe:

- **Due leghe**: Divisione d'Onore e Campionato dell'Abnegazione (la serie cadetta). La carriera parte nella lega che vuoi; a fine stagione due salgono e due scendono, con budget e reputazione che seguono la direzione.
- **Coppa Nazionale Trofeo Bellandi**: sedici società a eliminazione diretta — le prime 8 di ogni serie dalla seconda stagione, mentre all'esordio del mondo quindici estratte a sorte più la tua. Quattro turni infrasettimanali (Ottavi, Quarti, Semifinale, Finale) giocati tra le giornate di campionato, con la finale che arriva prima della 38ª. Niente pareggi: se i minuti finiscono pari, i rigori li gioca chi guarda — QTE dal dischetto per i propri tiri (tre piazzamenti estratti da dieci), da portiere su quelli avversari con parata indovinando la direzione. Tutto deterministico dal seed.
- **Squalifiche**: espulsione = una giornata di stop, quinta ammonizione = una giornata e il contatore riparte. Vale per chiunque scenda in campo, QTE o simulazione che sia.
- **Classifiche separate** per lega, calendari distinti: le partite di Coppa non toccano i campionati.
- **Rosa leggibile su mobile**: la riga del giocatore va su due righe al telefono (il nome si legge per intero), una riga al desktop.
## Stack

React · Vite · Tailwind CSS · Dexie (IndexedDB) · Zustand · PRNG con seed (carriere deterministiche e condivisibili)

## Decisioni di design

- Solo Italia al lancio, piramide a due leghe (Divisione d'Onore + serie cadetta) con promosse e retrocessioni; carriera inizia nella lega che vuoi. Data model multi-lega e multi-nazione dalla nascita: nazioni estere e Nazionali arrivano post-rilascio
- Partite della propria squadra sempre live, con QTE nei momenti chiave (3 opzioni, timer 10 s, scelta prudente allo scadere)
- Durata partita a scelta dell'utente: 1-2 min (compressa) · 5-6 min (rilassata) · 7-8 min (cronaca estesa); "salta al risultato" proposto prima del fischio d'inizio
- Massimo 3 sostituzioni a partita, con stamina per ruolo e impatto deterministico dei freschi
- Attributi 1-20 come fonte di verità, OVR derivato per ruolo: la crescita e il declino si vedono punto per punto
- Chi gioca migliora di più: la progressione dipende dai minuti, dall'età e dal potenziale nascosto
- Gestione completa: mercato, contratti, morale, rapporti
- Potenziale dei giovani mai rivelato: stima degli osservatori, margine che si restringe potenziando la rete
- Abilità Speciali con rarità (comune → leggendaria)
- Nomi fittizi credibili, niente cliché

## Roadmap

- [x] F0 — Fondazioni: scaffold, Dexie, PRNG, CI
- [x] F1 — Generatori dell'universo fittizio
- [x] F2 — Data model & gestione (carriere, contratti, moduli, giovanili)
- [x] F3 — Motore partite live, QTE, sostituzioni, infortuni, progressione, fine stagione
- [x] F3.5 — Attributi 1-20, OVR derivato, schede giocatore
- [x] F4 — Mercato: finestre estiva e invernale, trattative con controfferta, offerte AI, la lega che commercia
- [x] F5 — Abilità Speciali e osservatori
- [x] F5.5 — Restyle grafico: identità «Notte di Divisione d'Onore» + logo kit
- [x] F6 — PWA completa (manifest, service worker con banner Aggiorna, _headers, installazione Android + iOS)

Serie G — prima dell'app Android:

- [x] G1 — La Piramide: serie cadetta, scelta del club tra le due leghe, promozioni e retrocessioni a fine stagione, Coppa Nazionale Trofeo Bellandi tra le due leghe, squalifiche (rossa = 1 giornata, 5 ammonizioni = stop)
- [ ] G2 — Banco e Lavagnetta: moduli di gioco (4-3-3, 4-4-2, 3-4-3…) con slot per ruolo e matchup tra moduli, tattiche di squadra (attacco sulle fasce, contropiede, pressing a tutto campo…) che muovono le probabilità del motore
- [ ] G3 — Cassa e Stadio: incassi da affluenza (forma, posizione, capienza), sponsor, monte ingaggi, prestiti
- [ ] G4 — Occhi sui Grandi: osservatori anche sui seniori avversari, attributi stimati finché non scoutati
- [ ] G5 — Il Mercato degli Allenatori: club AI che licenziano per i risultati, candidature e offerte di lavoro, albo d'oro e storia della lega
- [ ] F7 — Capacitor (app vera)
- Post-rilascio: nazione estera, Nazionali

## Deploy

GitHub → Cloudflare Pages (project TBD).

---

© 2026 Little Elsewhere · MIT License
