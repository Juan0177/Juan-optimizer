# Juan-optimizer

Copia di [Stellar Optimizer](https://github.com/s-naveen/stellar-optimizer) (licenza AGPL v3), a sua volta basato su
[Genshin Optimizer](https://github.com/frzyc/genshin-optimizer) (licenza MIT), per [JuanLab](https://juan0177.github.io/JuanLab/).

**Licenza: GNU AGPL v3 o successiva** (`LICENSE`; avvisi in `NOTICE` e `LICENSE-GENSHIN-OPTIMIZER`). Chi usa il sito deve
poter avere il codice sorgente: è questo repository, ed è linkato nei crediti della home e in `LICENSE.txt` del sito.

- **Sito:** https://juan0177.github.io/Juan-optimizer/
- **Ramo di lavoro e predefinito:** `juanlab`. Il ramo `master` non si usa.
- **Staccato dagli originali:** da qui non partono mai commit, pull request o issue verso `frzyc/genshin-optimizer` o
  `s-naveen/stellar-optimizer`. Da Stellar Optimizer si prendono solo gli aggiornamenti, quando li lanci tu.

## Cosa contiene

La base è [Stellar Optimizer](https://github.com/s-naveen/stellar-optimizer) (solo Genshin): ottimizzatore riscritto,
rotazioni simulate con la logica di gioco, KQM Theorycrafting (build KQM, calcolatore ER, confronto costellazioni) e i
contenuti della beta presi dal dump del gioco (`apps/frontend/beta-content.json`, `tools/dump-import`).
Sopra ci sono le aggiunte di JuanLab (marcatore `juanlab` nel codice, elenco sotto): import da UID con Enka o Akasha,
collegamento a gc-web, home e crediti, italiano come lingua predefinita, nome e logo del fork.

Del sito di Stellar sono stati tolti: le statistiche Cloudflare, il pulsante Feedback (mandava i messaggi al suo server),
i link al suo sito pubblicato e alle donazioni, e i suoi workflow di pubblicazione.

## Aggiornare da Stellar Optimizer

Non parte da solo.

1. Guarda se ci sono novità: https://github.com/s-naveen/stellar-optimizer/commits/main
2. Lancia **Actions → "JuanLab - sync e Pages" → Run workflow** sul ramo `juanlab`.

Il workflow (`.github/workflows/juanlab-pages.yml`):

- unisce `s-naveen/stellar-optimizer` (`main`) in `juanlab`, tiene solo il nostro workflow e sempre la nostra versione di
  README, home, `index.html` e avvisi di licenza (`NOTICE`, `apps/frontend/public/LICENSE.txt`);
- costruisce il sito e lo pubblica su GitHub Pages;
- a ogni push su `juanlab` ricostruisce e ripubblica;
- se l'unione ha un conflitto vero non pubblica nulla e prova ad aprire una issue "Sync da Stellar Optimizer non
  riuscito": il sito resta all'ultima versione buona.

Gli aggiornamenti di Genshin Optimizer arrivano tramite Stellar Optimizer, che li unisce lui.
Quando Stellar modifica i propri workflow, il token predefinito delle Actions non può fare il push dell'unione:
serve un secret `SYNC_TOKEN` (token personale con permessi `contents` e `workflows`), altrimenti si unisce a mano.

## Impostazioni del repository

- **Settings → Pages → Source:** GitHub Actions.
- **Settings → General → Default branch:** `juanlab` (l'ambiente `github-pages` pubblica solo dal ramo predefinito).

## Sviluppo in locale

Serve Node 24 (versione in `.nvmrc`) con Yarn tramite Corepack.

```bash
corepack enable
yarn install --immutable
yarn nx serve frontend
```

Build di produzione, come nel workflow:

```bash
yarn nx run frontend:build:production
```

Il risultato è in `dist/apps/frontend` e funziona anche sotto un sottopercorso (`/Juan-optimizer/`).

## Modifiche proprie

Ogni modifica propria del fork porta il commento `juanlab`, così si ritrova con una ricerca.

- **Import da UID** (`libs/gi/ui/src/juanlab/`): campo "Importa dalla vetrina" nella home e nella scheda di upload del database.
  La vetrina arriva da Enka.network tramite il Worker di JuanLab (`juanlab-enka…workers.dev`), viene convertita in GOOD
  (tabelle ID → chiave del datamine di GO, ordine dei talenti dai dati pubblici di Enka) e passa dall'import GOOD di GO,
  con l'anteprima prima di salvare. Armi e manufatti già presenti e non in vetrina restano nel database.
  In alternativa **da Akasha** (scelta salvata nel browser): tutte le build salvate su akasha.cv, più build per personaggio,
  diventano Build di Genshin Optimizer (`akashaToGood.ts`, percorsi `/akasha/…` dello stesso Worker).
- **Collegamento a gc-web** (`libs/gi/ui/src/juanlab/gcweb.ts`, `GcwebLink.tsx`): scambio di build con gc-web, il pannello
  di LunaGC sul PC. Si attiva nella finestra d'import (voce "Collegamento a gc-web", con l'indirizzo di gc-web, di base
  `http://127.0.0.1:8090/`); spento, i link in arrivo vengono ignorati e il pulsante non compare.
  - Juan-optimizer → gc-web: "Invia a gc-web" nella scheda del personaggio apre gc-web con i manufatti equipaggiati
    (`#juanlab=…`), che lì diventano una build di CharacterBuilder.
  - gc-web → Juan-optimizer: "Apri in Juan-optimizer" su una build apre `#/?gcweb=…`; la home la converte in GOOD (manufatti
    equipaggiati al personaggio, che viene aggiunto se manca) e apre l'import con l'anteprima. Il resto dell'inventario resta.
  - Personaggi dell'account: «Esporta i personaggi in Juan-optimizer» in gc-web apre `#/?gcweb=z.…` (JSON compresso) con tutti
    i personaggi del server privato (livello, ascensione, costellazioni, talenti, arma e manufatti equipaggiati, niente
    inventario) nella forma della vetrina di Enka: la home li importa con lo stesso convertitore dell'import da UID.
  - Il link porta un formato neutro con gli ID del gioco (`JuanLabBuild` versione 1: set, slot `EQUIP_…`, statistiche
    `FIGHT_PROP_…` con il valore mostrato in gioco), uguale a `public/juanlab.js` di gc-web.
- **Contenuti della beta**: vengono da Stellar Optimizer (kit dal dump della beta). Le schede dei personaggi beta mostrano
  l'avviso "dati provvisori" (`libs/gi/ui/src/juanlab/beta.tsx`).
- **Home** (`libs/gi/page-home/src/index.tsx`, `JuanlabCards.tsx`): introduzione, import da UID, i primi passi e
  l'inventario di Stellar, crediti (GO, Stellar Optimizer, licenza AGPL e link al sorgente).
- **Nome e logo** (`apps/frontend/src/app/Header.tsx`, `juan_logo.svg`, `public/favicon.svg`, `public/og-image.png`,
  `index.html`, `ui.json`): Juan-optimizer al posto di Stellar Optimizer; il footer linka il sorgente del fork e Stellar.
- **Italiano** come lingua predefinita (`libs/gi/i18n/src/i18n.ts`) e nomi delle statistiche in italiano
  (`libs/gi/keymap/src/KeyMapIt.ts`).

Le altre modifiche sono piccole: se Stellar tocca le stesse righe, il sync si ferma e va unito a mano.

## Crediti

Stellar Optimizer è di s-naveen e dei suoi contributori, con licenza GNU AGPL v3 (vedi `LICENSE` e `NOTICE`).
Genshin Optimizer è di [frzyc](https://github.com/frzyc) e dei suoi contributori, con licenza MIT (vedi
`LICENSE-GENSHIN-OPTIMIZER`). Genshin Impact è di HoYoverse; questo progetto non è affiliato a HoYoverse.
