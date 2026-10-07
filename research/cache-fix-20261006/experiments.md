# Registro degli esperimenti

Ordine effettivo conservato in `episodes.json`; nessun episodio a pagamento rilanciato, omesso o sostituito. Le impostazioni sono uguali all'interno di ogni terna, con prompt congelato precedente nella terna1 e prompt affinato comune nella terna2. La seconda terna inverte l'ordine trattamento/controllo.

1. Congelamento di estensione, SQLite store, HTTP e prompt correnti in `control/`, con hash del provider/loader realmente installati in `control-freeze.json`.
2. `current diagnostic offline`: primo tentativo fallito per `listen EPERM 127.0.0.1` nel sandbox, zero inferenza e nessun HTTP esterno. Artifact conservati.
3. `current diagnostic2 offline`: loopback autorizzato; sette risposte simulate del provider nativo, sei azioni corrette; snapshot precedente sostituito a ogni richiesta.
4. `journal diagnostic offline`: sette risposte simulate; prototipo conserva l'intero input precedente come prefisso. Questa prova da sola non prova cache hits.
5. `current pair1`: controllo congelato reale, sette HTTP settled, corretto; cache si ferma a10.624 token dopo prima notifica con contenuto.
6. `baseline pair1`: stessi fatti e strumenti, iniezione disabilitata; sette HTTP settled, corretto; cache continua a crescere.
7. `journal pair1`: stesso runtime più prototipo in memoria; sette HTTP settled, corretto; cache cresce e costo vicino al baseline.
8. Applicata la correzione alla sorgente principale con metadati Pi persistenti/ancore del prefisso. Aggiunta spiegazione dell'ultima coda attiva ai prompt. `fixed diagnostic offline`: sette risposte simulate, sette metadati isolati.
9. `fixed pair2`: correzione principale reale, sette HTTP settled, corretto. Cache miss alla seconda richiesta, prima della prima notifica con contenuto; da richiesta3 cache cresce regolarmente.
10. `baseline pair2`: sette HTTP settled, corretto; cache cresce regolarmente.
11. `current pair2`: sette HTTP settled, corretto; secondo cache miss precoce e successivi plateau. Tutti i miss inclusi nei totali.
12. `npm test`:35 pass,9 EPERM per server locali nel sandbox; verifica ripetuta con loopback autorizzato: **44/44 pass**. Non interpretati come regressioni o fallimenti delle notifiche.
13. `npm run test:pi`: integrazione SQLite, cambio sessione, ripresa e wildcard single/batch, senza inferenza: **pass**.
14. `offline-resume.mjs`: sessione Pi salvata con il corretto, vero arresto e riavvio sullo stesso file, sette snapshot recuperati nella prima richiesta ripresa, quattordici risposte simulate totali; nessun HTTP esterno.
15. Consolidazione e cleanup:42 HTTP settled,6 episodi completi, tutti i fatti/azioni corretti, nessuna riserva sconosciuta, hash control invariati, zero processi Pi propri residui, receiver chiusi, link auth temporanei rimossi. Nessun nuovo run autorizzato.

Le prove misurate durano21–28 secondi ciascuna; sono fixture brevi per la cache, non workload da10 minuti. HTTP al modello, tool, quota cache, frequenza di hit e stima economica sono separate in `metrics.json`.
