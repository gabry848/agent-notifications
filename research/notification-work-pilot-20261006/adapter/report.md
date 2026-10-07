# Adapter Agent Coordinator — preparazione verificata

È pronto un adattamento isolato del **server reale** [gabry848/agent-coordination](https://github.com/gabry848/agent-coordination), commit `84fa1a0e53342aa6bf41648aa1a4c2ed2512d9f3`, MIT. Il server upstream immutato è `upstream_server.py`; l'estensione `coordinator_server.py` ne usa davvero `CoordinationStore`, schema, conflitti e risposte MCP. Non è un server imitativo. Nessuna board o configurazione MCP di produzione è stata modificata.

Il contratto reale upstream ha sei tool: `list_activities`, `upsert_activity`, `finish_activity`, `post_message`, `list_messages`, `check_conflicts`. La skill autorizzata nomina anche start/update: la copia offre alias `start_activity` e `update_activity`, mantenendo `upsert_activity`. La parte PR/release Fentaris non è attivata.

## Trasporto e fatti

Un daemon loopback centrale conserva la board SQLite del gruppo. Ogni sessione Pi ha un client MCP stdio attraverso SDK e `stdio_proxy.py`. I trigger SQLite scrivono l'evento nella stessa transazione della modifica all'attività o messaggio. Ogni fatto ha identità persistente board+sequence, entityId e revision. Un outbox separato conserva destinazione e tentativi. Il server non è un orchestratore e le attività non sono lock.

La sottoscrizione specifica **project, actor, sessionId UUID, URL loopback**. Gli eventi dello stesso actor non tornano a lui; messaggi diretti vanno al destinatario, le attività possono essere filtrate per file/area. I gruppi N/PA/W devono avere project diversi e directory diverse, con identiche fixture. Nessun evento è un permesso di scrittura: prima di un file sovrapposto resta necessario `check_conflicts`.

`get_updates({project,actor,cursor})` e `await_next(...)` leggono gli stessi eventi persistenti delle notifiche. L'attesa restituisce immediatamente fatti già in coda, altrimenti usa una Condition, con timeout 0–60 secondi e `cancel_wait(waitId)`. Non chiama GitHub o altri servizi per controllare lo stato. L'outbox controlla invece la propria coda locale e ritenta la consegna HTTP: questa attività backend non è una model/tool call e va distinta nelle metriche.

`publish_update({project,targets,kind,payload,producerId,revision})` permette al **solo harness esterno** di pubblicare diagnostica reale o fatti esterni. È assente dai tool Pi. Il front door HTTP richiede un token produttore, generato su file privato: `startBoard().call('publish_update', args)` lo legge internamente; non restituirlo, stamparlo o passarlo nell'env di Pi. Due pubblicazioni uguali per producer/kind/revision mantengono lo stesso evento; un contenuto diverso con la stessa identità è rifiutato. I fatti futuri devono restare nell'oracle/harness finché l'evento reale li produce.

Il trasporto nativo congelato è una **copia** di quello esistente, con prompt V3/tail/batch dismiss e aggiunta `eventId` idempotente all'ingresso. Una ritrasmissione non duplica un evento neppure dopo dismiss/riavvio, mentre lo stesso eventId su UUID diversi resta separato. L'arrivo non avvia inferenza. Si conserva il limite 8000 caratteri del messaggio; nessuna troncatura silenziosa. Diagnostica grande deve usare riferimenti ad artifact e un riepilogo completo dei fatti indispensabili.

## Pi e contabilità

`startDefaultPi()` legge i default reali di Pi: **0.99.2, openai-codex/gpt-6.1-sol, thinking medium**. Nessun `--model`, `--provider` o `--thinking`. Copia solo settings pertinenti in config isolata e usa un link alla autenticazione già autorizzata. Non esportare directory config/auth nei report. I tool nativi per read/edit/write/bash rimangono disponibili, salvo `tools` esplicitamente selezionati dalla suite.

Deviazioni comuni da registrare: trasporto **SSE** per tutte le modalità (il default normale è auto), pacchetti/skill/contesto automatici disabilitati, estensioni esplicite, retry dell'agent disabilitati. I retry interni del provider restano possibili ma ogni HTTP viene intercettato prima del fetch. Nessuno schema cache API è iniettato: cache nativa Codex.

`meter-extension.ts` usa ledger SQLite condiviso fra gli incarichi. Il guard riserva sul corpo HTTP reale non compresso, compresi retry, e non legge/stampa credenziali. Usa il limite modello di output 128000 token e un upper bound UTF-8+8192 per input/framing; tariffa input/cacheWrite più alta del tier appropriato. Per 80000 byte: riserva **1.50048 USD** per request, **4.50144 USD** per tre request concorrenti. Valutare la headroom prima del gruppo; è una riserva prudenziale, non il costo osservato.

Cap autorizzati prima delle misure: adapter2 / explorer2 / suite6 USD, globale10 USD. Usage grezzo terminale regola la riserva; richieste senza usage mantengono la riserva intera. Un blocco budget è un caso infrastrutturale/incompleto, mai una sconfitta funzionale delle notifiche. La massima concorrenza e i massimi numeri di prove del piano restano vincoli separati.

Il **costo effettivo subscription non è osservabile**. Il report separa usage grezzo, costo nominale Pi e stima equivalente API. Tariffe nominali del catalogo Pi coincidono con quelle documentate nella campagna precedente: input2/output10/cacheRead0.1/cacheWrite2.5 USD per milione; oltre272000 token input diventano4/15/0.2/5. Cache è sottratta una volta dall'input; reasoning è un sottoinsieme output, senza doppio conteggio. Non dichiarare spesa reale0 se tariffa o fatturazione non sono disponibili.

## Uso negli incarichi

Importare esclusivamente gli entrypoint dentro `frozen/` descritti in `ready.json`; verificare `source-hashes.json` prima delle misure. Il codice che Pi sviluppa deve vivere altrove, per non cambiare il trasporto congelato sotto osservazione.

```js
const board = await startBoard(groupDirectory);
const pi = startDefaultPi({
  work: actorDirectory, configDir: privateConfigDirectory, eventsPath,
  extraExtensions: [ready.entrypoints.coordinatorExtension],
  env: {
    PI_NOTIFY_READY: actorReadyPath, PI_NOTIFY_DB: actorSQLitePath,
    PI_NOTIFY_TRACE: notificationTracePath,
    PI_NOTIFY_CONTEXT: mode === 'N' ? '1' : '0',
    PILOT_COORDINATOR_ENDPOINT: board.ready.url,
    PILOT_COORDINATOR_PROJECT: uniqueProjectPerGroup,
    PILOT_ACTOR: actorName,
    PILOT_COORDINATOR_TRACE: mcpTracePath,
    PILOT_RUN_ID: runId, PILOT_SCOPE: 'suite', PILOT_SCOPE_CAP: '6',
    PILOT_GLOBAL_CAP: '10', PILOT_LEDGER: sharedPilotLedgerPath,
    PILOT_METER_TRACE: meterTracePath,
  },
});
await pi.waitReady();
const resolved = await pi.command({type:'get_state'});
// Register all three actors first; issue their task prompts concurrently only after preflight/headroom.
// Publish producer facts using board.call('publish_update', ...), outside the Pi processes.
// Then stop only owned Pi clients and board; inspect actor and board SQLite cleanup state.
```

La bridge registra automaticamente la destinazione per N, senza model tool call; PA/W non si iscrivono. I tool modello sono nativi senza prefix (`get_updates`, `await_next`, `upsert_activity`, ecc.). Per N nessun polling/await mentre resta lavoro utile; una attesa finale indispensabile va dichiarata fallback ibrido. Gli script possono notificare direttamente l'endpoint `/notify` esplicito, usando eventId. L'esploratore può usare soltanto trasporto/meter e una propria feed extension, purché i fatti/oracle restino equivalenti per tutte le modalità.

## Prove e limiti

Quattro test raggruppati passano: (1) normalization/tier/riserva concorrente/unknown; (2) ingresso idempotente, UUID e restart; (3) MCP reale, cinque eventi diretti, revisioni1/2/3, parità feed/iniezione, attesa immediata/cancellazione, unsubscribe, gate produttore; (4) Pi RPC col default reale, SDK/trasporto/meter caricati, evento durante idle senza inferenze e `publish_update` assente nell'inventario modello. Artifact: `traces/preflight-final.tap`; i sottotest salvano SQLite, RPC/event trace e assertions.

La prima esecuzione sandbox ha avuto due pass e due timeout di startup endpoint; lo stesso codice passa con endpoint loopback autorizzati. Il primo tentativo è conservato, senza attribuirlo al comportamento delle notifiche. Zero inferenze, nessun risultato prestazionale in questa preparazione.

Restano da verificare sul pilot: accounting grezzo nelle risposte reali del provider, azioni utili e prestazioni durante lavoro concorrente. L'outbox persiste, ma il test finale non esercita un riavvio del daemon durante una consegna interrotta. Dopo otto errori la consegna resta `failed` osservabile; nessun finto successo. TTL massimo2h; unsubscribe può non annullare un POST già in flight. Una board modificata direttamente fuori dal daemon durante le misure non è supportata. Il gate produttore non è una sandbox contro un agent malevolo che legga file fuori dal proprio workspace. Non sono stati eseguiti push/PR/release o cambiamenti globali.
