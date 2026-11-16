# Contenuti della beta (juanlab-beta)

Personaggi, armi e set della beta aggiunti dal fork prima che l'originale li pubblichi. Oggi: **7.3** (dati Nanoka
7.2.52): Danica, Anastasya; Torrents of Spring, Silverdawn, Blazing Lionfang; Epochal Advent, Empyrean Sojourn.

## Da dove vengono i dati

- [gi.nanoka.cc](https://gi.nanoka.cc/) (`static.nanoka.cc/gi/<versione>/en/<tipo>/<id>.json`): stessa struttura dei
  dati "Hakushin" che la pipeline di GO usa per la beta, con le chiavi in snake_case. `generate.ts` li converte e li
  salva in `data/` (formato Hakushin, senza i link dei tooltip).
- Seconda fonte per i controlli: [gachabase](https://gi.gachabase.net/changelog/beta?lang=en) (statistiche al livello
  90 e moltiplicatori dei talenti uguali). Dove i parametri della beta non corrispondono al testo delle costellazioni
  (C1, C2 e C6 di Danica, C2 di Anastasya) gli sheet usano i numeri del testo, che sono uguali sulle due fonti.

## Cosa genera `generate.ts`

Le stesse cose che la pipeline di GO genera per le chiavi Hakushin (gen-stats, gen-assets-data, gen-assets,
gen-locale), solo per le chiavi di `config.json`: `stats/Data/...`, `allStat_gen.json`, `AssetsData_gen.json` e le
icone in `assets/src/gen` (PNG dalle icone della beta), i testi inglesi `*_gen.json`, i materiali e un cartoncino
provvisorio del personaggio (icona sullo sfondo dell'elemento). La passiva della regione va in `passive3` e quella
di utilita in `passive`, come nel datamine di GO.

```bash
npx vite-node -c libs/gi/dm/juanlab-beta/vite.config.mts libs/gi/dm/juanlab-beta/generate.ts --fetch
```

Senza `--fetch` usa i dati gia salvati in `data/`. Serve Python con Pillow per le icone.

## Nuova versione della beta

1. Aggiorna `nanokaVersion` in `config.json` (l'ultima e in `https://static.nanoka.cc/manifest.json`, voce `gi.latest`).
2. Lancia lo script con `--fetch` e controlla le differenze.
3. Se cambiano i numeri dei talenti, gli sheet si aggiornano da soli; se cambia il testo di passive o costellazioni,
   correggi i valori scritti a mano negli sheet (`libs/gi/sheets/src/...`, cerca `juanlab-beta`).

## Quando l'originale li pubblica

Si tiene la versione dell'originale e si cancella la nostra: cerca `juanlab-beta` (chiavi in `consts`, mappe ID,
sheet di personaggi/armi/set, formula, cartoncini, avviso in `libs/gi/ui/src/juanlab/beta.tsx`), togli le chiavi da
`config.json` e lascia che il sync porti i file generati dall'originale.
