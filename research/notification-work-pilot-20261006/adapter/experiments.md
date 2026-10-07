# Esperimenti di preparazione — nessuna inferenza

1. Discovery SkillGesture e lettura AOVerview, piano e skill Coordinator indicata dall'utente. Nessun tool Coordinator esposto. Ricerca read-only nelle copie/proxy/plugin locali non ha trovato sorgenti.
2. Il portfolio locale identifica il repo reale pubblico `gabry848/agent-coordination`. Le prime richieste `gh api` nel sandbox falliscono per connessione; read-only autorizzato riesce. Scaricato archivio: prefisso `gabry848-agent-coordination-84fa1a0`, corrispondente al commit registrato.
3. Ispezione server upstream: Python stdlib, SQLite, sei tool reali. Aggiunti alias start/update, trigger event/revision/outbox, routing e feed equivalenti; nessuna modifica ai sorgenti originali o a board prod.
4. Prima preflight sandbox: pure meter/store2 pass, Coordinator/Pi startup2 timeout. Output osservato descritto in `traces/preflight-first-attempt.json`; stderr dei daemon di quel tentativo non fu catturato. Non diagnosticare un errore funzionale dai soli timeout.
5. Preflight loopback autorizzata:4/4. Raffinamento gate produttore + inventario Pi:4/4; artifact distinto. Raffinamento metering su vero corpo HTTP zstd/SSE, ultimo preflight4/4 in `traces/preflight-final.tap`.
6. Congelamento dei dodici file runtime e provenance/hash. Scope cap aggiornati prima di misure a2/2/6, globale10. Nessuno smoke pagato: prima misura provider e uso reale saranno dati separati dei ricercatori.

I test usano fixture funzionali minime e brevi attese tecniche per startup/cancellazione; non sono workload lunghi né prove di performance.
