# Cache delle notifiche: diagnosi e correzione, 6 ottobre 2026

La perdita di cache è stata riprodotta con il provider Codex reale di Pi. Conservare gli snapshot già inviati, immutabili nelle loro posizioni precedenti, ripristina nelle prove controllate l'avanzamento della cache della conversazione. Il blocco era già in coda: spostarlo non era una diagnosi sufficiente.

La correzione è applicata a `src/pi-extension.ts` e `src/notification-context.mjs`. Il default nativo `openai-codex` usa la nuova proiezione. Gli altri provider conservano il default precedente, perché non sono stati verificati in questa ricerca. `PI_NOTIFY_CACHE=dynamic` permette un confronto con il comportamento precedente; `journal` abilita esplicitamente la proiezione.

## Risultati reali

Ogni episodio usa il default effettivo `openai-codex / gpt-6.1-sol / medium`, sette HTTP al modello e sei chiamate al tool della fixture. Nessun output/model override, polling, dismiss o history aggiuntivo. Una sola sessione misurata alla volta. Tutti i sei episodi sono completi e corretti; tutte le 42 richieste hanno usage raw e settlement.

| Terna | Variante | Input cumulativo | Input cached | Cache / input | Stima API USD |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | Senza iniezione | 120.338 | 92.544 | 76,90% | 0,0666424 |
| 1 | Iniezione corrente congelata | 121.081 | 60.544 | 50,00% | 0,1293484 |
| 1 | Prototipo append-only | 122.616 | 94.208 | 76,83% | 0,0680368 |
| 2 | Senza iniezione | 120.695 | 93.056 | 77,10% | 0,0663836 |
| 2 | Iniezione corrente congelata | 121.439 | 72.960 | 60,08% | 0,1060540 |
| 2 | Correzione applicata | 123.069 | 87.040 | 70,72% | 0,0825620 |

Il prototipo riduce la stima di **$0,0613116** rispetto alla versione corrente nella prima terna; resta **$0,0013944** sopra il controllo senza iniezione. La correzione applicata riduce la stima di **$0,0234920** nella seconda terna; l'intero episodio rimane **$0,0161784** sopra il controllo. Questi delta includono tutti i risultati, anche i cache miss iniziali.

Nella terna2 sia corrente sia corretto hanno un miss alla seconda richiesta, **prima dell'arrivo di una notifica con contenuto**; il baseline riceve un hit. La causa esatta di quel singolo miss non è osservata, e non lo rimuoviamo dai totali. Dopo il riscaldamento, la correzione aumenta regolarmente i cached token:

```
Corretto:  10.752 → 14.080 → 17.408 → 20.736 → 24.064
Baseline:  10.752 → 13.824 → 17.152 → 20.352 → 23.552
Corrente:  10.752 → 10.752 → 17.152 → 17.152 → 17.152
```

Come vista **aggiuntiva**, le ultime quattro richieste della terna2 danno **84,47% cached nel corretto contro 84,88% nel baseline**; differenza economica **+$0,0015248**. Questo sottoinsieme esplicito serve a mostrare l'avanzamento dopo il riscaldamento, non sostituisce i totali. La frequenza di richieste con qualche cache hit è una metrica diversa: non basta un hit sul system prompt per dimostrare che la storia cresce in cache.

Totale ricerca: **42 HTTP, 6 episodi, $0,5190272 equivalenti API stimati**, zero riserve sconosciute. La fatturazione effettiva della subscription resta ignota. Ledger nuovo e separato; il budget e gli artifact del pilot precedente non sono stati modificati.

## Causa osservata e funzionamento della correzione

L'estensione Pi riceve una copia del contesto. La vecchia iniezione aggiunge uno snapshot request-local; Pi conserva le risposte ma non quello snapshot. Nella chiamata successiva lo snapshot scompare, le nuove risposte/tool result prendono il suo posto e un altro snapshot entra in coda. La cache key, gli strumenti e le istruzioni sono rimasti stabili in tutti i run, ma la sequenza completa degli input precedenti non era conservata.

Gli esperimenti offline con la CLI e il provider realmente installati mostrano questa differenza. Le misure raw mostrano che, dopo la prima notifica con contenuto, la vecchia iniezione smette di estendere la cache a parte della storia nuova. Con gli stessi fatti e gli stessi strumenti, conservare gli input precedenti ripristina l'avanzamento. È una spiegazione empiricamente supportata per questo runtime; non osserviamo gli internals della cache server e non attribuiamo retroattivamente una causa certa a ogni miss del vecchio pilot.

La nuova proiezione conserva gli snapshot come **metadati custom della sessione Pi**, fuori dal transcript dei messaggi. A ogni chiamata ricostruisce le osservazioni precedenti nelle posizioni originarie e aggiunge il nuovo stato in coda. Ogni record è isolato per sessione e ancorato all'hash dell'intero prefisso della conversazione; i record di un diverso ramo o di una storia compattata non vengono inseriti dove l'ancora non coincide. La selezione usa solo il ramo Pi corrente.

Il prompt ora chiarisce che **solo l'ultima sezione è la coda attiva**. Gli snapshot vecchi sono osservazioni storiche; non riattivano eventi dismissati e non richiedono di ripetere azioni. Nessuna modifica allo schema cache del provider, al codice installato, alle credenziali o alla configurazione globale. Gli ID, timestamp, `t-N`, arrivi alla prossima chiamata naturale, autorità dei dati esterni, persistenza SQLite e dismiss `*` rimangono disponibili.

## Verifica e limiti

- **44/44 test** passati, compresi cinque nuovi test per prefisso, dismiss, compattazione, ancore e retry dello stesso contesto; integrazione Pi SQLite/wildcard passata.
- Fixture Pi offline del corretto: sette chiamate provider simulate, sette record di diario isolati. Una vera sessione Pi salvata è stata riavviata: i sette snapshot precedenti compaiono nella prima richiesta ripresa; quattordici metadati finali persistiti e nessuno snapshot aggiunto come turno nel transcript.
- Sei episodi reali corretti, controlli congelati invariati, usage raw coerente con la normalizzazione, receiver/processi propri chiusi e link temporanei di auth rimossi.
- La fixture rende gli stessi fatti anche nei risultati di un tool comune. Questo è voluto per isolare la cache e **non dimostra** alcun vantaggio di produttività delle notifiche.
- Conservare snapshot aumenta il contesto: nella conferma +2.374 token di input cumulativo rispetto al baseline. Molte notifiche lunghe mantenute attive possono produrre crescita significativa. La cache riduce il costo delle ripetizioni, ma non rende gratis dati nuovi; compattazione, ripresa senza sessione salvata e cambio modello possono legittimamente invalidarla.
- Nessun test da30/60 minuti, nessuna significatività statistica e nessuna promessa che tutti i costi diventino identici al caso senza notifiche. Il prossimo test di lavoro utile deve controllare soprattutto dimensione degli snapshot, compattazione e cache della storia effettivamente stabile.

## Artifact

- [Metriche JSON](metrics.json), [CSV](metrics.csv), [verifica](verification.json), [registro esperimenti](experiments.md).
- [Controllo congelato](control-freeze.json), [hash finali](source-hashes.json), [riavvio offline verificato](offline/durable-resume/assertions.json).
- `runs/*/summary.json`: usage raw, stime e stato di ogni HTTP; `hashes.jsonl`: hash/prefissi e azioni; `notifications.jsonl`: esposizioni e lifecycle.
- `private/`: payload della fixture con permessi restrittivi, senza header di autenticazione. Non distribuiti nei report pubblici. I log RPC pubblici filtrano thinking/signature.

Riproduzione dell'aggregazione senza nuove inferenze: `node research/cache-fix-20261006/report.mjs`. Il driver rifiuta ulteriori episodi misurati dopo i sei già autorizzati; un nuovo benchmark richiede un nuovo incarico e un nuovo budget.
