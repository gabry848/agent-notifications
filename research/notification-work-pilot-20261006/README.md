# Pilot — notifiche durante lavoro concorrente

Campagna separata dalle prove precedenti; avvio autorizzato il 6 ottobre 2026.

Il [report consolidato HTML](research.html) descrive il pilot parziale, la prova
operativa, il blocco delle riserve, la cache e il successivo dismiss con `*`.
I [dati compatti](report-data.json) si rigenerano con
`node research/notification-work-pilot-20261006/report.mjs` dalla root del progetto.
La modifica `*` non fa parte dei sorgenti congelati delle prove già eseguite.

## Scope e incarichi

- `adapter/`: sorgenti isolati e prove di un adapter Agent Coordinator con notifiche. Individuare il server reale, lavorare su una copia e distinguere eventuali impedimenti da ciò che è effettivamente implementato.
- `explorer/`: goal aperto, ipotesi e fino a sei esecuzioni Pi misurate nel primo pilot.
- `suite/`: suite prefissata e fino a tre gruppi misurati iniziali N/PA/W (al massimo nove sessioni Pi se ogni gruppo usa tre agent).
- `audit/`: verifiche indipendenti su task, log, correttezza e contabilità; nessuna nuova inferenza Pi richiesta per l'audit.

Ogni incarico ha il proprio task AOVerview a dettaglio medio. Le identità di reporting sono consegnate privatamente dal coordinatore. I subagent Codex ereditano il modello del main. Per Pi si registra e usa il modello predefinito effettivo, mantenendolo costante nei confronti.

## Limiti del primo batch

Budget massimo stimato delle inferenze Pi: **10 USD**, ripartiti prima delle misure in 2 USD per la preparazione/smoke dell'adapter, 2 USD per esplorazione e 6 USD per suite. La suite deve poter riservare conservativamente l'output massimo delle tre richieste Pi concorrenti senza cambiare il modello o aggiungere parametri non supportati. Gli importi sono cap prudenziali di campagna, non prezzi né stime del costo finale. Non modificare credenziali o account. Se il provider predefinito non consente una stima affidabile, segnalarlo prima di inferenze non limitate e conservare usage grezzo; non inventare una tariffa. Il cap non comprende il costo del runtime Codex che ospita queste deleghe. Un arresto per budget è un esito incompleto/infrastrutturale, non una perdita prestazionale attribuita alle notifiche.

Il default verificato in preparazione è `openai-codex/gpt-6.1-sol`, thinking medium, Pi 0.99.2. L'usage grezzo, il costo nominale restituito da Pi e una stima equivalente API sono misure distinte. Per il provider Codex il costo effettivo della subscription non è osservato: eventuali tariffe zero nella libreria non provano che il task sia gratuito. Il cap può usare una stima equivalente API esplicitamente etichettata e con provenienza delle tariffe registrata; non va presentata come fattura o costo effettivo Codex. La contabilità deve essere pronta prima delle inferenze misurate. I limiti sul numero di esecuzioni restano vincolanti.

Nessuna estensione automatica a 30–60 minuti. Prima si consegnano e discutono i dati del pilot. I dieci minuti sono un obiettivo di calibrazione del lavoro utile, non un timer da riempire artificialmente. Eventuali task più brevi si registrano come tali.

Le sessioni Pi misurate si avviano soltanto dopo disponibilità di trasporto stabile, preflight e contabilità. Esplorazione e suite possono progettare contemporaneamente alla preparazione MCP. Non modificare gli artifact precedenti, i sorgenti di produzione o i file di un altro incarico. Nessun push, PR, release o modifica al server/board di produzione.

## Consegne

Ogni incarico produce `report.md`, `metrics.json` o CSV quando pertinenti, `experiments.md` e tracce verificabili. Registrare tutti i tentativi e i risultati negativi. Non dichiarare un beneficio prestazionale senza confronto valido né una sessione di dieci minuti se termina prima.

Il coordinatore integra le consegne, riassume limiti e risultati e prepara una nuova pagina HTML dopo il pilot. Il [piano completo](../../notification_research_plan_v2.md) resta il riferimento sul metodo.
