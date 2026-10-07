# Esperimenti e controlli dell'audit

- Lettura indipendente di piano, preparazione adapter, feed explorer, runner, prompt e oracle suite.
- Verifica read-only dei dodici SHA adapter, provenienza upstream e ventidue hash della mappatura suite v2.
- Individuazione del literal futuro `192` nel prompt della suite; correzione pre-run conservata come variante v2.
- Prima receipt explorer aggiornata dopo rafforzamento pre-run del runner; versioni iniziali e nuovi hash conservati. Nessuna inferenza era iniziata.
- Prima calibrazione ammessa: `N / compatibility / seed 4101`, ledger condiviso canonico, scope explorer2/global10, al massimo un nuovo caso.
- Riconciliazione usage: script read-only sul ledger e sui log. Nessun paid model call dell'auditor.

La prima azione utile richiede una modifica verificabile conseguente all'evento, non soltanto una dichiarazione nel submit finale.

- Verificati i ventitré hash finali della suite v3, la cattura del loader Pi effettivo e sette probe offline supplementari, inclusi tutti i diciotto export e il rendering con policy corrente. Rilascio suite separato dalla prima calibrazione, soltanto dopo chiusura, contabilità e cleanup explorer.
- Calibrazione explorer: il falso originale dell'oracle è conservato. Il CLI sotto src/ è ammesso dal task ed è stato eseguito nella copia audit; il comportamento corretto è registrato separatamente. Tentativo sandbox con loopback EPERM conservato; la verifica successiva è riuscita con approvazione di escalation. Nessuna inferenza dell'auditor.
- Verificati PA e N con tre Pi reali ciascuno, sorgenti congelati e gruppi sequenziali. PA completa i tre turni; N produce artefatti corretti ma view viene interrotto dalla guardia locale prima del report finale. W non viene avviato.
- Riconciliate tutte le 148 risposte HTTP del pilot con ledger, raw usage provider e usage SDK. Il messaggio SDK di errore con zero token, emesso prima di HTTP, è distinto dalle 54 richieste N realmente inviate e contabilizzate.
- Ricostruita la guardia: costo settled suite 1,4642072 USD equivalenti API, due riserve pendenti 3,08021 USD e nuova riserva 1,568385 USD; proiezione 6,1128022 USD oltre cap suite 6. Nessun HTTP 429, riserva ignota o errore del canale osservato.
- Controllati tool, actor/destinazioni, modifiche condivise, export, handoff, attività e cleanup. N mantiene l'attività testing di view come evidenza dell'arresto; nessun processo del pilot o endpoint resta attivo nei controlli registrati.
- Deduplicate le verifiche concorrenti per hash dei moduli del ruolo: sei chiamate PA diventano cinque versioni, cinque chiamate N diventano tre versioni. Non equivalgono a tempo risparmiato né a elaborazione continua dei peer.
- Contate esposizioni da contesto realmente inviato: 72 notifiche N consegnate, 66 ID esposti, 155 apparizioni, 89 reiniezioni. I sei eventi persistiti residui sono tutti posteriori all'ultimo snapshot del destinatario e mai esposti; backlog, non perdita.
- Individuata una modifica reale a policy 192 successiva all'iniezione sul ruolo view, privo di retrieval/await: esposizione dopo 5,28 s e codice dopo 20,53 s dalla conferma al produttore. È una prova operativa singola, non un confronto prestazionale valido.
- Generati report.md, metrics.json e metrics.csv. Nessuna prova da 10/30/60 minuti eseguita, nessun beneficio economico dichiarato, fatturazione effettiva della subscription ignota. Causa della differenza di cache ancora da investigare.
