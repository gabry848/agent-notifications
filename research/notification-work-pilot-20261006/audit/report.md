# Audit indipendente — pilot lavoro concorrente

**Il canale funziona e produce una modifica operativa durante altro lavoro. I confronti di efficienza rimangono incompleti.** Sono osservate sette sessioni Pi reali, 148 richieste HTTP contabilizzate, 2,066,247 token complessivi sulle richieste e 1.815854 USD equivalenti API. La fatturazione effettiva della subscription non è osservata. Nessuna nuova inferenza è stata eseguita dall'auditor.

## Risultati verificati

La calibrazione explorer dura **212,329 secondi**, non dieci minuti: un report esterno è esposto dopo 11,19 s e i suoi valori sono applicati a deployment/release dopo 111,65 s, senza get_updates, MCP o await. Quattordici test pubblici e quattro test aggiunti passano. Il CLI reale consegna un evento ed esce correttamente nella copia audit. Il primo checker automatico ha restituito falso perché escludeva i CLI sotto src/: il falso originale è conservato, con la verifica comportamentale indipendente separata. Tutti i quattordici milestone pubblici erano già passati prima dell'evento: questo limita la prova di overlap con lavoro di implementazione ancora pendente.

| Gruppo | Turni | Durata osservata s | HTTP modello | Token totali | USD equivalenti API | get_updates / await |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| PA | completo | 209.4 | 82 | 1,168,728 | 0.502734 | 16 / 4 |
| N | interrotto | 204.7 | 54 | 776,871 | 1.172560 | 0 / 5 |

PA completa tre agent concorrenti, diciotto funzioni pubbliche, integrazione, handoff e cleanup attività. Anche gli artefatti N passano i test, tutti i diciotto export e i probe sul rendering con POLICY192. Ma view si ferma sulla guardia locale prima di results/view.json e chiusura attività: **N non è eleggibile per un confronto di efficienza**. W è sospeso e non ha generato inferenze; non è una perdita né un pareggio misurato. N include cinque await finali/di integrazione; il solo actor view gestisce il contract senza retrieval/await.

La prova operativa è [contract-action-evidence.json](contract-action-evidence.json): N view vede il valore tramite iniezione dopo 5,28 s e modifica davvero il codice dopo 20,53 s, mentre ingest e delivery hanno turni aperti. PA usa get_updates e modifica dopo 32,26 s. Questi intervalli partono dalla conferma al produttore; la creazione dell'evento è precedente e non è il punto iniziale della misura. Un solo caso per modalità e il successivo arresto N impediscono di chiamare questa differenza una vittoria temporale confermata.

## Contabilità e arresto

Tutte le 148 risposte contabilizzate sono settled e coincidono con l'usage Pi. Cache sottratta una volta, reasoning non duplicato, nessuna riserva ignota. Un messaggio SDK con usage 0 è l'errore **prima** dell'invio HTTP, non una richiesta inviata al provider. Nessun HTTP 429 osservato. Le stime includono tutti i tentativi reali, anche il gruppo incompleto.

Alla guardia N, 1,4642072 USD equivalenti API erano settled nella suite e due richieste avevano 3,08021 USD riservati. La nuova riserva di 1,568385 USD avrebbe portato il totale prudenziale a 6,1128022 USD, oltre il cap suite di 6 USD. La riserva considera il massimo output di 128.000 token; non corrisponde alla spesa effettiva. Prova: [reservation-guard-diagnostic.json](reservation-guard-diagnostic.json). È un limite dell'harness e della concorrenza prudenziale, non un fallimento del canale.

Cache letta sul totale input: PA 89.4%, N 35.9%. La causa della differenza non è stabilita. La stima equivalente API di N è maggiore in questo tentativo, ma non si può attribuire una differenza finale di efficienza a un task interrotto.

## Isolamento, coordinazione e cleanup

Dodici hash adapter e ventitré hash runtime suite verificati; upstream reale commit 84fa1a0e53342aa6bf41648aa1a4c2ed2512d9f3. publish_update assente dagli strumenti modello; token produttore fuori dall'env Pi. PA ha blocco notifiche disabilitato. Nessuna destinazione UUID errata, actor estraneo o modifica diretta a un modulo di peer. I comandi bash ispezionati eseguono test e diagnostica Git read-only; non modificano file fuori scope. Gli edit condivisi sono preceduti da check e rilettura, e tutti gli export/handoff restano presenti. Questi test non dimostrano hard lock né assenza universale di race.

Il controllo dopo i run ritrova tutti i dodici hash adapter, i ventitré hash suite e i cinque hash explorer uguali ai manifest congelati. È un controllo puntuale, non monitoraggio continuo: [post-run-source-integrity.json](post-run-source-integrity.json).

72 notifiche N consegnate, 66 ID esposti, 155 apparizioni e 89 reiniezioni. Le apparizioni con notifiche corrispondono a richieste HTTP realmente inviate; il solo snapshot bloccato dalla guardia contiene zero notifiche. I sei eventi attivi residui sono tutti arrivati dopo l'ultimo snapshot dell'actor e sono persistiti come backlog. L'arrivo non avvia né interrompe inferenza. Endpoint e processi dei gruppi risultano chiusi; i soli link auth dei config temporanei sono rimossi, senza eliminare il file auth originale. L'attività board di view rimane testing come prova dell'arresto.

L'overlap non viene gonfiato dai test ripetuti: PA ha sei verifiche durante un peer turn, corrispondenti a cinque versioni sorgente; N cinque verifiche e tre versioni. Un turno peer aperto non prova computazione continua né venti minuti di lavoro risparmiato. Definizione e prove: [overlap-versions.json](overlap-versions.json).

## Limiti e prossimo passo

Tutte le sessioni riuscite durano circa tre minuti e mezzo. Non sono test da 10/30/60 minuti e non simulano un job remoto di venti minuti. Il corpus explorer è pubblico e analizzabile autonomamente; il report è una computazione reale breve attivata da un trigger sintetico di progresso. I fatti esterni prefissati sono identici; i messaggi e le attività prodotti dagli agent sono esiti del workflow e non uno stream identico tra modalità. SSE, retry automatici Pi disabilitati e config isolata sono deviazioni comuni registrate. Nessuna modifica a server/board di produzione o artifact precedenti.

Prima di una campagna lunga: rendere la riserva capace di attendere headroom con deadline e contabilizzare tale attesa; verificare offline il mapping del contesto/cache nativa; rendere coerente il cursor tra iniezione e fallback; correggere il checker CLI senza perdere il negativo; calibrare un workload realmente più ampio. Ogni nuova variante va congelata e i confronti ripetuti in condizioni comparabili. Nessuna estensione automatica a 30/60 minuti è autorizzata da questo audit.

Prove principali: [metrics.json](metrics.json), [usage-reconciliation.json](usage-reconciliation.json), [gate](preflight-gate.json), [suite release](suite-release.json), [N audit](group-N-audit.json), [PA audit](group-PA-audit.json), [residui](notification-residuals.json).
