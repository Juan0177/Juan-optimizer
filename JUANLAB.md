# Juan-optimizer

Fork personale di [Genshin Optimizer](https://github.com/frzyc/genshin-optimizer) (licenza MIT) per [JuanLab](https://juan0177.github.io/JuanLab/).
Serve ad aggiungere i personaggi della beta prima che arrivino nel ramo ufficiale; per il resto è identico a upstream.

- Sito: https://juan0177.github.io/Juan-optimizer/
- Ramo di lavoro (e default): `juanlab`. Il ramo `master` non si usa.

## Aggiornamento e pubblicazione

Il workflow `.github/workflows/juanlab-pages.yml`:

- quando lo lanci a mano (Actions → "JuanLab - sync e Pages" → Run workflow) unisce `frzyc/genshin-optimizer` (`master`) in `juanlab`, ricostruisce e pubblica il sito. Non parte da solo: il controllo degli aggiornamenti è un promemoria nel calendario;
- a ogni push su `juanlab` ricostruisce e pubblica;
- se l'unione fallisce non pubblica nulla e prova ad aprire una issue "Sync da upstream non riuscito".

Quando upstream modifica i propri file in `.github/workflows`, il token predefinito delle Actions non può fare il push dell'unione.
Per evitarlo aggiungi un secret `SYNC_TOKEN` (token personale con permessi `contents` e `workflows` su questo repository);
senza, in quei casi basta unire a mano.

## Aggiunte di JuanLab

Ogni modifica propria del fork porta il commento `juanlab-beta`, così si ritrova con una ricerca e si toglie
quando il personaggio esce nella versione ufficiale.
