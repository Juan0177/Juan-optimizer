# Juan-optimizer

Copia personale di [Genshin Optimizer](https://github.com/frzyc/genshin-optimizer) (licenza MIT) per [JuanLab](https://juan0177.github.io/JuanLab/).

- **Sito:** https://juan0177.github.io/Juan-optimizer/
- **Ramo di lavoro e predefinito:** `juanlab`. Il ramo `master` non si usa.
- **Staccato dall'originale:** da qui non partono mai commit, pull request o issue verso `frzyc/genshin-optimizer`. Dall'originale si prendono solo gli aggiornamenti, quando li lanci tu.

## Cosa contiene

Solo Genshin Optimizer: l'app `apps/frontend` e le librerie che usa (`libs/gi`, `libs/common`, `libs/pando`, `libs/game-opt`).
Sono stati tolti Star Rail (`libs/sr`, `apps/sr-frontend`), Zenless (`libs/zzz`, `apps/zzz-frontend`), il bot Somnia, il frontend sperimentale `apps/gi-frontend` e i workflow dell'originale.

Per ora le build si caricano solo dalla vetrina di Enka (import da UID tramite il Worker di JuanLab).
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
Il README è nostro: durante il sync si tiene sempre questa versione.

## Crediti

Genshin Optimizer è di [frzyc](https://github.com/frzyc) e dei suoi contributori, con licenza MIT (vedi `LICENSE`).
Genshin Impact è di HoYoverse; questo progetto non è affiliato a HoYoverse.
