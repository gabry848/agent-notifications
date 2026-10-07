# Benchmark notifiche Pi

Questo harness misura processi reali e richieste reali al modello. Non risveglia Pi quando arriva una notifica. I task lavorano solo sulle fixture della singola prova.

La [pagina della ricerca](../artifacts/benchmark-real-20261006-r1/research.html) racconta metodo, risultati, prove funzionali e limiti della campagna completata. Si apre direttamente nel browser, anche offline; i grafici usano dati incorporati. Per rigenerarla dagli artifact esistenti, senza avviare Pi o nuove inferenze:

```sh
node benchmark/research.mjs
```

## Esecuzione e ripresa

```sh
npm test
node benchmark/run.mjs --campaign benchmark-real-20261006-r1 --phase pilot --scenarios S1,S3 --repeat 2
node benchmark/run.mjs --campaign benchmark-real-20261006-r1 --phase main --repeat 5
node benchmark/report.mjs artifacts/benchmark-real-20261006-r1
```

La campagna completa prosegue serialmente dopo i 120 casi principali:

```sh
node benchmark/after-main.mjs benchmark-real-20261006-r1
```

`campaign-progress.json` indica la fase corrente. Non avviare due driver sulla stessa campagna. Le fasi successive sono affinamento, holdout, funzionalità, GitHub, regressione e report.

Una prova già completata viene letta senza rifarla. Un tentativo incompleto non viene sovrascritto: occorre un nuovo seed, una variante o una nuova campagna. Ogni fase salva l'ordine randomizzato. Il modello, i prezzi verificati e gli hash di configurazione sono negli artifact. Le campagne precedenti del progetto restano separate.

Il seed controlla fixture e ordine delle modalità, non il campionamento del modello. Sono conservate anche le differenze nel modo in cui l'agent raggruppa le modifiche ai file o sceglie attese maggiori. Ogni caso ha una nuova identità Pi e un database isolato.

N usa il blocco dinamico; P10 impone almeno 10 secondi tra i controlli; PA usa minimi di 2, 4, 8, 16 e 30 secondi; W attende tramite tool. Gli intervalli decorrono dal controllo precedente, e il lavoro indipendente può occupare quell'intervallo. Le modalità polling non possono usare await_jobs. N può usarlo solo come fallback: è conteggiato e non dimostra un beneficio attribuibile esclusivamente alle notifiche.

I prompt impongono intervalli minimi: il modello può scegliere attese maggiori e questa scelta resta nelle tracce. Non trattare P10 come un timer deterministico di dieci secondi.

## Posizione e cache

`--position before-input` dispone il prefisso stabile, poi le notifiche, poi l'input corrente. Il valore di controllo `tail` mantiene il comportamento precedente. Nelle chiamate dopo un tool, il batch finale di risultati è l'input corrente; non si sposta l'intera conversazione dopo l'ultimo messaggio utente.

`--cache stable` è un esperimento specifico del provider: pone fino a quattro breakpoint espliciti sul prefisso prima delle notifiche. Mantiene il primo blocco e tre estremi recenti della storia, per rendere riutilizzabile anche il precedente endpoint. I dati dinamici rimangono fuori dai breakpoint. Anche le baseline ricevono questa strategia nel holdout, se selezionata. La sintassi è documentata nella [guida ufficiale al prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

Il payload compatto elimina la diagnostica non necessaria al task, conservando tutti i fatti richiesti e un riferimento al job. Nel holdout questo formato si applica allo stesso modo a notifiche, `get_job` e `await_jobs`: non confrontiamo notifiche compatte con baseline inutilmente verbose.

Il record completo S6 supera il limite di 8.000 caratteri del messaggio, come osservato in `main-S6-601-N-v2-full`: HTTP 400, risultato poi acquisito tramite await. Questi tentativi restano fallimenti del canale, anche se il piano finale è corretto. Prompt e layout vengono affinati con S6 compatto, a parità tra candidati; il confronto full/compact conserva anche la variante rifiutata. Il limite del prodotto rimane invariato.

L'affinamento confronta prima due prompt su dieci casi ciascuno, poi quattro combinazioni posizione/cache su quattro casi ciascuna, infine payload completo/compatto. Il caso con sei job è stato aggiunto dopo la doppia submission osservata in `main-S4-403-N-v2-full`, conservando il fallimento iniziale. Seleziona prima la correttezza, poi il costo mediano. `selected.json` conserva punteggi e hash; `confirmation-frozen.json` viene scritto prima del holdout su dieci seed nuovi per scenario. Il migliore e il peggiore scenario di sviluppo vengono entrambi mantenuti. La cache hit rate è cache read / totale input; il costo include anche cache write.

`frozen-runtime/` conserva i sorgenti effettivi e i relativi hash della configurazione selezionata. La conferma controlla prima di ogni caso che quel runtime non sia cambiato. Le prove principali già avviate conservano gli hash originali e i payload effettivamente preparati.

I tool di lavoro leggono e scrivono solo i moduli fixture. Il server MCP stdio usa l'SDK ufficiale, avvia worker Node separati e registra ogni chiamata. Un risultato fallito è un fatto del lavoro, distinto da un errore di trasporto.

I worker locali sono carichi controllati: attendono realmente per la durata fissata dalla fixture e producono un risultato. Non rappresentano una compilazione o una CI di produzione. Le modifiche agli otto moduli e i relativi test sono eseguiti realmente; la fase GitHub usa anche workflow remoti reali. Nelle prove senza tools/call restano il collegamento MCP e la sua inizializzazione: il conteggio zero riguarda le chiamate ai tool, non l'assenza di un server MCP.

## Costi e risultati

`budget.sqlite` contiene riserve e usage grezzo normalizzato. Il limite massimo è 100 USD; le soglie cumulative delle fasi sono 8, 50, 65, 90 e 100 USD. Gli errori degli hook non bloccano da soli Pi: quando manca budget, il processo termina prima dell'HTTP con exit 73. Richieste senza usage mantengono la riserva conservativa. Il cap è per questa campagna: non modifica il budget dell'account del provider.

Le tariffe Standard del modello sono state verificate il 6 ottobre 2026 sulla [pagina ufficiale GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol): il report indica stime, non importi verificati su una fattura. Reasoning è già parte dell'output; cache read e cache write non sono sommati nuovamente all'input grezzo.

Le mediane prestazionali usano prove corrette e complete nelle misure. Errori, timeout e costi di tutti i tentativi restano nel JSON e nel CSV. Gli intervalli bootstrap sono abbinati per scenario, seed e fase; campioni piccoli sono esplorativi. Il tempo di reazione riportato alla submission è un limite superiore: non misura il momento interno in cui il modello ha compreso il fatto.

`taskMs` va dall'invio del task alla prima submission; `wallMs` comprende anche la risposta finale e la verifica del risultato. `totalWallMs` aggiunge l'avvio di Pi e MCP, misurato subito prima dello spawn; la costruzione delle fixture e della configurazione temporanea precede quel timer. `providerTotalMs` somma i tempi delle richieste al modello, senza attribuire al provider l'attesa dentro i tool.

`providerLatencies.firstTokenMs` misura il primo delta visibile di testo, argomenti di tool o riepilogo del ragionamento. Non osserva l'inizio del ragionamento interno del modello.

La soglia di conferma sul tempo usa `wallMs`, includendo risposta finale e chiamate dopo la submission. Questa scelta viene congelata prima del holdout: la prima submission da sola può sembrare veloce anche se l'agent continua poi con lavoro inutile. Il report conserva separatamente entrambi i tempi e le chiamate successive al piano.

`verification.json` controlla i payload effettivamente preparati per il provider, l'assenza del blocco nelle baseline e l'assenza degli ID dismissati nei contesti successivi. I log contengono dati della fixture, non chiavi o header di autenticazione. Le credenziali Pi sono copiate solo in una configurazione privata temporanea e poi eliminate.

## Prove funzionali

```sh
node benchmark/utility.mjs benchmark-real-20261006-r1
```

Comprendono MCP che avvisa senza tools/call, backlog mentre Pi è inattivo, ripresa dello stesso ID dopo arresto, duplicati e testo ostile. Queste prove dimostrano il canale della nostra integrazione; non provano che lo stesso comportamento sia impossibile con altri sistemi di eventi. SQLite conserva gli eventi già ricevuti, ma l'endpoint attuale non riceve mentre Pi è spento.

Cinque ulteriori seed del caso con sei job verificano il lifecycle della configurazione selezionata: nessuna ripetizione del piano dopo il dismiss. Sono controlli funzionali, senza baseline per rivendicare un vantaggio prestazionale.

L'affinamento confronta inoltre dismiss singolo e a gruppi su quattro coppie di S6, dopo il formato compatto e la cache. Il flag `--dismiss batch` usa `notifications_dismiss({ids:[...]})`; il default mantiene `{id}`. Si può selezionare una strategia solo se completa tutti e quattro i task e non lascia eventi attivi dopo il turno. Il conteggio SQLite è letto senza avanzare `t-N`. Il confronto resta esplorativo; il holdout usa poi la strategia congelata.

Un controllo negativo disabilita iniezione e tool di recupero: il risultato esterno sconosciuto deve restare indisponibile. È un'ablazione funzionale, esclusa dai confronti di efficienza.

## Demo GitHub reale

`benchmark/github/run.mjs` usa la fixture privata indicata in `github-fixture.json`, espone solo il ricevitore firmato con `vpnbar share`, installa un webhook `workflow_run` e confronta success/failure/cancelled con N e P10, due ripetizioni. Il server MCP dispatcha realmente il workflow. La modalità N attende eventi del filesystem prodotti dai webhook, senza polling GitHub nascosto. Le chiamate API del driver, del server e dell'agent sono distinguibili nelle tracce.

`externalApiInvocations` conta le richieste GitHub del server MCP: dispatch, eventuali controlli e cancellazione automatica della fixture. `github-evidence.json` distingue quest'ultima dalle altre richieste e dalla lettura dei tempi effettuata dal driver; la cancellazione programmata non è una chiamata a un tool dell'agent.

Il primo dispatch reale ha rivelato un HTTP 422: `gh api` richiede input annidati con `inputs[experiment_id]`, non chiavi con il punto. Il tentativo fallito e il costo API sono conservati. `github-adapter-repair.json` e le copie dei sorgenti documentano la correzione; una coppia aggiuntiva sul seed 3003 completa il confronto senza riscrivere il tentativo iniziale.

GitHub resta una demo esplorativa con due coppie valide per esito. La schedulazione remota e i tempi di cancellazione variano realmente: i tempi totali non isolano il solo effetto delle notifiche. Le richieste di stato effettive, i timestamp dei job e la ricezione locale restano verificabili separatamente.

Un preflight supplementare non ha ricevuto il ping entro trenta secondi e si è fermato prima delle inferenze. Il successivo verifica prima la raggiungibilità del ricevitore, poi il ping firmato, con novanta secondi di margine e fino a tre nuovi ping. Il DNS di un hostname appena creato ha inizialmente restituito `ENOTFOUND`, poi ha funzionato senza cambiare il DNS del computer. I preflight restano negli artifact e non vengono presentati come prove del modello.

Il workflow ha timeout cinque minuti, non distribuisce software e non salva artifact. I costi runner sono riservati prima di ogni dispatch; la stima usa i tempi dei job e la [tariffa ufficiale Linux](https://docs.github.com/en/billing/reference/actions-runner-pricing). Non assume che i minuti inclusi rendano il costo nullo. Alla fine elimina il proprio webhook, ferma la propria condivisione e cancella eventuali workflow incompleti di questi esperimenti. Il repository privato resta disponibile per verificare le prove.

## Aggiungere altri processi

`runCase` separa il task dal producer: `specOverride` definisce job, risultato atteso e lavoro indipendente; `BENCH_SERVER` seleziona un adapter MCP, come quello GitHub. Le quattro modalità ricevono gli stessi fatti e svolgono lo stesso task. Cambia il modo in cui acquisiscono il risultato, mentre fixture, oracle e misure restano condivisi.

Un adapter avvia il processo reale con `start_job`, espone `get_job` e `await_jobs`, registra inizio/fine e, in N, invia l'evento HTTP. Deve conservare URL e ID della sessione destinataria al lancio, includere identità dell'esecuzione e revisione, e inviare una sintesi entro il limite dell'endpoint. I log completi restano un artifact separato; l'eventuale recupero va contato nelle chiamate. Un atteso sconosciuto all'agent viene verificato da un oracle indipendente, conservando anche tutti gli esiti errati.

Prima si verifica il trasporto senza inferenza, poi poche prove esplorative; si congela la configurazione e si passa a seed nuovi. Una nuova fonte non eredita automaticamente i benefici misurati per gli altri scenari.
