# Juan-optimizer

Copia personale di [Genshin Optimizer](https://github.com/frzyc/genshin-optimizer) (licenza MIT) per [JuanLab](https://juan0177.github.io/JuanLab/).

- **Sito:** https://juan0177.github.io/Juan-optimizer/
- **Ramo di lavoro e predefinito:** `juanlab`. Il ramo `master` non si usa.
- **Staccato dall'originale:** da qui non partono mai commit, pull request o issue verso `frzyc/genshin-optimizer`. Dall'originale si prendono solo gli aggiornamenti, quando li lanci tu.

## Cosa contiene

Solo Genshin Optimizer: l'app `apps/frontend` e le librerie che usa (`libs/gi`, `libs/common`, `libs/pando`, `libs/game-opt`).
Sono stati tolti Star Rail (`libs/sr`, `apps/sr-frontend`), Zenless (`libs/zzz`, `apps/zzz-frontend`), il bot Somnia, il frontend sperimentale `apps/gi-frontend` e i workflow dell'originale.

Le build si caricano dalla vetrina di Enka (import da UID tramite il Worker di JuanLab) o arrivano da gc-web con un link.
I personaggi della beta verranno dopo: il piano è nel documento "Genshin Optimizer di JuanLab: specifica e piano".

## Aggiornare dall'originale

Non parte da solo. Il 1° e il 15 di ogni mese c'è un promemoria nel calendario.

1. Guarda se ci sono novità: https://github.com/frzyc/genshin-optimizer/commits/master
2. Lancia **Actions → "JuanLab - sync e Pages" → Run workflow** sul ramo `juanlab`.

Il workflow (`.github/workflows/juanlab-pages.yml`):

- unisce `frzyc/genshin-optimizer` (`master`) in `juanlab` e toglie di nuovo le parti che non servono, anche se l'originale le ha modificate, così non diventano conflitti;
- costruisce il sito e lo pubblica su GitHub Pages;
- a ogni push su `juanlab` ricostruisce e ripubblica;
- se l'unione ha un conflitto vero (nelle parti di Genshin) non pubblica nulla e prova ad aprire una issue "Sync da upstream non riuscito": il sito resta all'ultima versione buona.

Quando l'originale modifica i propri workflow, il token predefinito delle Actions non può fare il push dell'unione.
Per evitarlo aggiungi un secret `SYNC_TOKEN` (token personale con permessi `contents` e `workflows` su questo repository); senza, in quei casi si unisce a mano.

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
- **Home** (`libs/gi/page-home/src/index.tsx`, `JuanlabCards.tsx`): introduzione, import da UID, inventario, squadre e crediti;
  tolti pubblicità, link a social e donazioni, video guida, note di versione e resina.
- **Niente pubblicità** in tutto il sito (`ADS_ENABLED = false` in `libs/common/ad/src/consts.ts`).
- **Correzione** in `libs/common/ui/src/components/GeneralAutocomplete.tsx`: le opzioni dei campi di ricerca (set, armi,
  personaggi) usavano `MenuItem`, che con MUI 9 manda in crash l'editor dei manufatti ("MenuListContext is missing").

Durante il sync si tiene sempre la nostra versione di README e home; le altre modifiche sono piccole e, se upstream tocca
le stesse righe, il sync si ferma e va unito a mano.

## Crediti

Genshin Optimizer è di [frzyc](https://github.com/frzyc) e dei suoi contributori, con licenza MIT (vedi `LICENSE`).
Genshin Impact è di HoYoverse; questo progetto non è affiliato a HoYoverse.
