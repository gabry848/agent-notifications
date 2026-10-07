# Suite prefissata — report parziale consolidato

L’iniezione ha prodotto un’azione osservabile: view ha applicato la policy ricevuta nel contesto senza retrieval o await. **Il confronto di efficienza resta incompleto:** PA conclude tutti i turni, N viene interrotto dalla guardia locale delle riserve e W non è stato eseguito. Il coordinatore ha confermato la sospensione, senza nuove inferenze o variazioni di cap.

Due gruppi misurati, sei sessioni Pi reali con il modello default `openai-codex/gpt-6.1-sol/medium`. Tutti i 136 HTTP sono settled e riconciliati, zero riserve sconosciute, nessun 429. Totale: **1,675294 USD equivalenti API stimati**; fatturazione reale della subscription non disponibile.

| Dato osservato | PA | N |
| --- | ---: | ---: |
| Tutti i turni conclusi | sì | **no** |
| Oracle libreria/file | passa | passa |
| Durata gruppo | 209,4 s | 204,7 s, episodio incompleto |
| HTTP modello | 82 | 54 |
| Token totali, cache inclusa | 1.168.728 | 776.871 |
| USD equivalenti API | 0,5027344 | 1,1725596 |
| Cache letta / input totale | 89,38% | 35,92% |
| `get_updates` / `await_next` | 16 / 4 | 0 / 5 |

L’audit indipendente è **concluso** per entrambi i gruppi: diciotto export pubblici conservati, rendering lungo alla policy ricevuta e cambio dinamico della policy corretti, test aggiunti passati, file immutabili e scope rispettati, nessun actor o destinatario estraneo. Gli edit condivisi hanno check e rilettura precedenti; non dimostrano un lock atomico. PA non contiene notifiche nel contesto e rispetta il backoff. Receiver e processi sono chiusi; rimossi soltanto i link auth temporanei. In N l’attività di view rimane `testing` e manca il suo report finale, conservando la prova dell’interruzione. [Audit PA](../audit/group-PA-audit.json), [audit N](../audit/group-N-audit.json), [integrità sorgenti](../audit/post-run-source-integrity.json).

Nel caso N la policy viene esposta dopo **5,28 s** dalla conferma al produttore e il codice cambia dopo **20,53 s**, con i turni ingest/delivery aperti. PA espone la policy via `get_updates` dopo 27,55 s e modifica dopo 32,26 s. Un solo evento per modalità e l’arresto N impediscono di considerarli un vantaggio temporale confermato. View N ha zero retrieval/await; ingest e delivery includono cinque await finali o di integrazione. [Prova dell’azione](../audit/contract-action-evidence.json).

In N: 72 consegne, 66 ID esposti, 155 apparizioni, 89 reiniezioni. I sei eventi residui sono arrivati dopo l’ultimo snapshot degli actor, mai esposti e persistiti come backlog. L’arrivo non avvia un’inferenza. [Residui](../audit/notification-residuals.json). L’overlap conta sei verifiche PA e cinque N durante un turno peer aperto, deduplicate in cinque e tre versioni di modulo; non prova computazione continua del peer. [Definizione e verifica](../audit/overlap-versions.json).

Alla guardia N, il totale prudenziale sarebbe stato **6,1128022 USD > cap6**: 1,4642072 già settled, 3,08021 riservati per due richieste pendenti, 1,568385 per la nuova richiesta. L’HTTP nuovo non è stato inviato. La stima settled finale della suite è 1,675294 USD; il cap include output massimi da 128k token. È un limite dell’harness. [Diagnosi guardia](../audit/reservation-guard-diagnostic.json).

Le sessioni durano circa tre minuti e mezzo: target dieci minuti non raggiunto, nessuna durata artificiale. La causa del diverso cache hit non è stabilita. Risultati esplorativi, senza conclusioni generali su risparmio di tempo/costo.

Questa consolidazione aggiorna solo la narrazione con l’audit concluso; metriche, tracce, risultati e sorgenti congelati restano invariati. [Dettagli](findings.md), [metriche](metrics.json), [CSV](metrics.csv), [registro](experiments.md), [freeze workload](suite-frozen.json), [freeze runtime](runtime-frozen.json), [emendamento pre-run](runtime-budget-amendment.json).
