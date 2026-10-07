# Risultati parziali della suite prefissata

La suite ha eseguito due gruppi, con tre Pi reali concorrenti per gruppo. Il modello effettivo è il default `openai-codex / gpt-6.1-sol / medium`; i gruppi sono stati isolati, con lo stesso workload e i sorgenti congelati. W è sospeso dopo una guardia delle riserve di budget; nessuna esecuzione è stata rilanciata o nascosta.

| Dato osservato | PA | N |
| --- | ---: | ---: |
| Episodio interamente concluso | sì | **no** |
| Oracle libreria/file | passa | passa |
| Turno del gruppo | 209,4 s | 204,7 s, **non confrontabile come vittoria** |
| HTTP effettivi | 82 | 54 |
| Token totali, cache inclusa | 1.168.728 | 776.871 |
| Stima equivalente API | 0,5027344 USD | 1,1725596 USD |
| Cache-read / input totale | 89,38% | 35,92% |
| Await richiesti dai modelli | 4 | 5 |

Le stime non sono fatture della subscription. Tutte le 136 richieste sono settled, con zero riserve sconosciute. Nel caso N la guardia ha respinto una futura richiesta di view prima dell'HTTP durante la conclusione del turno; il costo realmente stimato della suite era 1,675294 USD, ma il cap6 comprende anche riserve conservative di tre output potenzialmente da 128k token. L'errore non è un rate limit e non dimostra un limite del canale notifiche; rende incompleto l'episodio e invalida un confronto di efficienza complessiva.

## Un fatto utile arriva durante il lavoro

View in N ha ricevuto la policy esterna nel contesto, senza `get_updates`, `list_messages` o `await_next` per recuperarla. L’audit finale misura dalla conferma al produttore: prima esposizione dopo 5,28 s, modifica osservabile della policy dopo 20,53 s, mentre i turni dei peer erano aperti. Nel solo caso PA: esposizione tramite `get_updates` dopo 27,55 s, modifica dopo 32,26 s. La creazione dell’evento precede questa conferma e non è l’origine di queste latenze. Sono singoli eventi esplorativi, non una conferma di vantaggio generalizzabile. [Evidenza indipendente](../audit/contract-action-evidence.json).

Il rumore sulla mensa non richiedeva interventi; la ricevuta del dataset serve solo alla consegna finale. I risultati dell'audit indipendente distinguono questi eventi dalle azioni sulla policy. Gli await finali di ingest/delivery restano nei dati: N non è un episodio globale puro senza await.

## Costo e cache

N ha meno richieste e meno token totali, ma molto più input non cached: 486.810 contro 122.473. Output: 17.165 contro 15.471. La differenza di stima economica è soprattutto nel mix di cache, non in cento token aggiuntivi. Non attribuiamo ancora una causa al cache miss.

Una prova di serializzazione **offline**, zero Pi e zero HTTP, sul provider Codex realmente installato conserva notifiche sintetiche in coda e mantiene i precedenti elementi/cache key. Non ricostruisce i payload misurati e non spiega il gap osservato. Una successiva indagine dovrà acquisire i payload reali e verificare il comportamento della cache senza confondere provider o configurazioni.

## Limiti e prove

Le sessioni hanno circa tre minuti e mezzo di lavoro reale, non dieci minuti né un'ora; nessuno sleep è stato aggiunto per allungarle. Un solo gruppo per modalità. Le metriche base di overlap contano verifiche riuscite mentre un altro turno resta aperto; l'audit deduplica per hash del modulo per non contare più volte lo stesso lavoro. Un turno aperto non prova calcolo continuo del peer.

L’audit indipendente di PA e N è concluso: tutti i diciotto export, rendering alla policy192 e cambio dinamico a207, test aggiunti, scope, file immutabili e cleanup verificati. PA conclude tutte le attività; N conserva l’attività `testing` di view e il report mancante. Zero actor estranei e zero modifiche dirette ai moduli dei peer. I check precedenti agli edit condivisi non sono lock atomici. [Audit PA](../audit/group-PA-audit.json), [audit N](../audit/group-N-audit.json).

Le verifiche durante un turno peer aperto sono sei PA/cinque N, corrispondenti a cinque/tre versioni uniche di modulo. N ha 72 consegne, 66 ID esposti, 155 apparizioni e 89 reiniezioni. Tutti i sei residui sono successivi all’ultimo contesto dell’actor e persistiti: l’arrivo non avvia inferenza. [Overlap](../audit/overlap-versions.json), [backlog](../audit/notification-residuals.json).

Il coordinatore ha confermato: nessuna nuova inferenza, nessuna variazione di cap, W sospeso. La consolidazione è solo narrativa; tracce, metriche e freeze restano invariati. Il task AOVerview rimane in attesa per la guardia di capacità.

Il primo prompt aveva un leakage del valore futuro nella forma del report: corretto **prima di qualsiasi inferenza**, con v1/v2 e snapshot preservati. Il workload e l'oracle sono rimasti congelati; il runtime corretto è v3.

- [Metriche](metrics.json), [CSV](metrics.csv), [registro](experiments.md).
- [PA](traces/group-PA/summary.json), [N incompleto](traces/group-N/summary.json).
- [Cleanup PA](traces/group-PA/cleanup-additional.json), [cleanup N](traces/group-N/cleanup-additional.json): receiver chiusi, zero processi propri e soli link auth temporanei rimossi; auth originale non eliminata.
- [Freeze workload](suite-frozen.json), [freeze runtime](runtime-frozen.json), [audit supplementare](../audit/suite-offline-supplemental.json).
- [Probe cache offline](offline-codex-prefix-probe.json).
