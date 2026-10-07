# Ricerca sulle notifiche durante il lavoro degli agent

Data: 6 ottobre 2026.

Stato: avvio del pilot autorizzato dall'utente il 6 ottobre 2026. Quattro incarichi con task AOVerview separati: preparazione MCP, esplorazione, suite prefissata e verifica indipendente. I subagent Codex ereditano il modello del main; le sessioni Pi usano il modello predefinito di Pi. Le prove da 30–60 minuti restano successive alla revisione condivisa del pilot.

## Obiettivo

Capire quanto aiuta un agent ricevere fatti e aggiornamenti mentre continua un compito reale, senza doverli cercare e senza un nuovo prompt dell'utente.

Il focus è su attività concorrenti, lavoro utile indipendente ed eventi anche non bloccanti o non richiesti. Non cerchiamo principalmente di battere await quando l'unica azione possibile è aspettare un risultato.

Un beneficio può essere meno controlli, migliore consapevolezza del lavoro degli altri, un'azione anticipata, meno lavoro da rifare oppure un task completato con meno tempo o costo. Alcuni eventi non richiedono alcuna azione: anche ignorarli correttamente è un comportamento da verificare.

## Cosa esiste già

- Store SQLite persistente, POST /notify, sessioni separate per UUID, ID, timestamp UTC ed età t-N.
- Iniezione delle notifiche nella successiva richiesta al modello, tool nativi Pi per dismiss e history, prompt affinato e dismiss a gruppi opzionale.
- Una campagna di 270 esecuzioni reali, con 60/60 conferme corrette, prove funzionali e tredici workflow GitHub completati e verificati.
- Prove di eventi esterni senza MCP tools/call, backlog, riavvio della stessa sessione, duplicati e testo ostile.

I confronti precedenti hanno mostrato benefici rispetto al polling in alcuni scenari, ma nessun beneficio confermato rispetto al controllo await secondo le soglie congelate. Le sessioni riuscite erano brevi: la più lunga circa 2 minuti e 35 secondi. I tentativi iniziali di oltre dieci minuti erano timeout, non lavoro utile prolungato.

La notifica non avvia inferenza e non interrompe un tool o una richiesta in corso. Viene vista alla prossima preparazione del contesto. L'endpoint attuale non riceve nuovi eventi quando il processo Pi è spento; SQLite conserva quelli già ricevuti.

Riferimenti: [ricerca precedente](artifacts/benchmark-real-20261006-r1/research.html), [risultati](artifacts/benchmark-real-20261006-r1/results.json), [metodo](benchmark/README.md).

## Organizzazione

Il main svolge il ruolo di coordinatore: assegna scope, cartelle, identificativi, budget e calendario delle prove; controlla le esecuzioni e integra i risultati. Gli agent di ricerca svolgono il lavoro operativo.

Tre ruoli indipendenti:

1. **Esploratore con goal aperto.** Trovare dove Dynamic Notifications producono benefici reali nei benchmark. Libertà di scegliere workload e ipotesi, senza una lista rigida di casi favorevoli. Deve conservare vittorie, pareggi e sconfitte, distinguere esplorazione e conferma e rispettare limiti di budget e numero di esperimenti fissati prima di partire. Il goal non autorizza a cercare indefinitamente finché emerge una vittoria.
2. **Suite prefissata.** Definire e congelare una famiglia di workload prima dell'esecuzione. Confrontare notifiche, polling adattivo e await competitivo sugli stessi compiti. La suite non cambia in risposta ai risultati dell'esploratore durante quel batch.
3. **Verificatore indipendente.** Controllare task, file e risultati, completezza dei log, correttezza delle metriche e validità dei confronti. Separare i fatti osservati dalle interpretazioni; evidenziare errori, confondenti e costi non contabilizzati.

L'adattamento del server MCP è un ulteriore incarico di implementazione, organizzabile come preparazione o in una seconda ondata, senza sovraccaricare il coordinatore. Può essere anche un workload lungo da confrontare, partendo dallo stesso snapshot in ogni modalità.

Tutte le esecuzioni su Pi, inclusi gli agent che implementano il server, usano il **modello predefinito di Pi**, senza imporre il modello della campagna precedente. Prima delle prove si registra il modello/provider effettivo; nei confronti abbinati rimane costante.

AOVerview traccia la campagna a dettaglio medio, con identità distinte per i subagent, risultati verificabili e collegamenti agli artifact.

## Workload e Agent Coordinator

I compiti devono offrire lavoro utile durante l'esecuzione dei processi in background: sviluppo su più moduli, test, analisi e integrazione. Le durate e i fatti futuri restano nascosti all'agent. Si includono completamenti fuori ordine, fallimenti, aggiornamenti pertinenti e notifiche irrilevanti.

Gli eventi possono:

- Comunicare un risultato utile mentre l'agent modifica altro.
- Segnalare una modifica di requisito o un problema esterno.
- Sbloccare un intervento, una verifica o una correzione anticipata.
- Aggiornare lo stato di un altro agent senza richiedere una reazione immediata.
- Servire soltanto alla fine: questi casi sono controlli per distinguere il valore delle notifiche dal semplice parallelismo.

Per Agent Coordinator, adattare la componente di coordinamento descritta nella skill `/Users/gabry848/.skillgesture/skills/fentaris/workflow/subskills/fentaris-dev-pr-agent-coordination/versions/1/SKILL.md`. È una board condivisa, non un orchestratore. Il workflow PR/release specifico di Fentaris non si applica automaticamente al laboratorio.

Il server MCP potrà consegnare eventi alla sessione Pi interessata quando arrivano messaggi, cambiano attività o viene liberata un'area/file. Vanno definite destinazione, iscrizione e cancellazione dell'iscrizione, identità/revisione degli eventi, deduplicazione e ciclo di vita. L'assenza di eventi non prova da sola che un file sia libero: prima di una modifica sovrapposta resta necessaria una verifica dello stato pertinente.

Le prove coinvolgeranno almeno tre agent Pi su aree o file vicini, con controlli sulle modifiche perse, interferenze e qualità dell'integrazione. Le notifiche sono dati esterni, non permessi né istruzioni autorevoli.

La modifica del server è un task realistico di sviluppo. Per misurarla, il trasporto notifiche in uso resta stabile mentre l'agent sviluppa la nuova versione in una copia separata. Prima di confrontare la nuova versione, si verificano e congelano server, prompt e configurazione: sviluppo del trasporto e misura non devono mescolarsi.

## Avvio graduale: prima circa dieci minuti

1. **Preparazione:** verificare strumenti, logging, oracle, trasporto e isolamento con controlli brevi. Registrare configurazione, massimo di esperimenti e budget per incarico e campagna.
2. **Pilot parallelo:** avviare insieme i tre subagent di ricerca, con output separati. Usare inizialmente workload calibrati per circa dieci minuti di lavoro utile per sessione Pi. Questo è l'ordine di grandezza del singolo workload, non una promessa che tutti i confronti e le ripetizioni durino dieci minuti in totale.
3. **Analisi condivisa:** il verificatore controlla i dati; il coordinatore riassume cosa ha funzionato, errori, risultati negativi e ipotesi da verificare. L'esploratore può proporre una variante per il batch successivo, mantenendo distinta la suite prefissata.
4. **Estensione:** se il pilot produce dati affidabili e workload pertinenti, congelare le configurazioni e passare a compiti da trenta minuti. Dopo un ulteriore controllo, estendere quelli appropriati a sessanta minuti.
5. **Conferma:** verificare le ipotesi emerse su istanze e seed nuovi, includendo controlli e condizioni sfavorevoli. Una suite prefissata esplorativa non è automaticamente la conferma finale.

Un task che termina prima resta un risultato valido e viene registrato con la sua durata reale. Non aggiungere sleep, lavoro fittizio o ripetizioni inutili per raggiungere il tempo desiderato. Calibrare la dimensione del lavoro prima di congelare il workload.

"Risultati buoni" significa innanzitutto dati completi, compiti verificati, lavoro realmente concorrente ed eventi osservabili. Non significa necessariamente che N vinca: anche un pareggio o una sconfitta attendibile è utile. Si correggono prima i problemi di misura e si evita di spendere un'ora su un test mal costruito.

## Parallelismo e confronto equo

I subagent lavorano contemporaneamente, con cartelle, identità Pi, database e budget separati. Le esecuzioni Pi possono essere concorrenti, ma la concorrenza delle misure deve essere controllata e registrata.

Nei confronti usare gli stessi job, fatti, esiti ed eventi, lasciando tutte le modalità libere di avviare processi in background e svolgere altro lavoro. Await può attendere singoli job o il primo risultato disponibile quando supportato; non va costretto ad aspettare tutto per rendere più favorevole N.

Con N non introdurre controlli di arrivo o await mentre resta lavoro utile. Se quel lavoro termina e manca un risultato indispensabile, l'eventuale fallback viene contato e il caso viene descritto come ibrido. Per eventi non bloccanti non occorre attendere soltanto per riceverli.

Per attribuire differenze temporali, confrontare gruppi sotto condizioni equivalenti di concorrenza, alternare/randomizzare le modalità e, se necessario, eseguire conferme isolate. Non attribuire alle notifiche ritardi dovuti a saturazione della macchina, provider o rete. Errori e rate limit rimangono nei dati; eventuali cambi di provider sono varianti separate, non confronti abbinati equivalenti.

## Metriche e lettura dei risultati

Misurare:

- Correttezza e lavoro completato e verificato, incluse integrazione e test sui file.
- Tempo fino alla consegna, turno completo e avvio della sessione, separatamente.
- Tempo dall'evento alla prima esposizione e alla prima azione utile conseguente, quando esiste. Gli eventi senza azione richiesta sono classificati a parte.
- Lavoro verificato svolto mentre i job sono pendenti, con definizione esplicita di overlap e senza doppio conteggio.
- Richieste al modello, token, tool, controlli di stato e API esterne, distinguendoli.
- Costi totali stimati e differenze **assolute in dollari**, oltre alle percentuali. Includere fallimenti, retry, cache e cleanup.
- Fallback await, notifiche ricevute/esposte/dismissate, duplicati, eventi persi e reiniezioni.
- Per la coordinazione: controlli della board, messaggi utili ricevuti, interferenze, modifiche perse e lavoro da rifare.

Un aumento percentuale ampio su pochi centesimi non descrive da solo l'impatto pratico. Valutare il costo marginale rispetto al beneficio ottenuto e al costo dell'intero task. Su sessioni lunghe l'overhead potrebbe pesare meno, ma eventi lasciati attivi e reiniettati molte volte potrebbero anche accumulare costo: entrambe sono ipotesi da misurare.

Una prova incompleta non conta come vittoria di velocità. Report finale: condizioni in cui le notifiche vincono, pareggiano o perdono, con limiti e artifact consultabili.
