# Risultati verificati — notifiche Pi

270 esecuzioni misurate con Pi reale: 258 task corretti, 11 fallimenti di sviluppo/infrastruttura conservati e 1 controllo negativo intenzionalmente privo del risultato. Le 60 conferme sul profilo congelato sono tutte corrette, con 60/60 payload conformi. Nessun HTTP 429.

| Scenario e controllo | Richieste modello risparmiate | Token risparmiati | Costo API risparmiato | Turno completo risparmiato |
| --- | ---: | ---: | ---: | ---: |
| Job 90 s, N vs polling adattivo | 68.8% | 62.7% | 45.4% | 16.8% |
| Diagnostica e 19 eventi irrilevanti, N vs polling 10 s | 22.2% | -26.3% | -63.0% | 18.3% |

Percentuali positive indicano risparmio; valori negativi indicano aumento. Ogni riga usa dieci coppie di seed nuovi. Le soglie congelate e i CI abbinati sono nel report. Nei job lunghi N usa await in 10/10 casi: il vantaggio è del profilo completo, non della sola iniezione. Nel rumore usa await in 2/10 casi. Nessuna soglia di vantaggio superata rispetto al tool che attende, W.

Profilo selezionato: prompt v3, notifiche in coda, cache esplicita sul prefisso stabile, payload compatto e dismiss a gruppi. Entrambe le baseline hanno la stessa cache e lo stesso formato dei risultati. I venti eventi sono stati rimossi in tutte le dieci conferme N con rumore. Il dismiss a gruppi completa una pulizia che il singolo ometteva: il confronto esplorativo tra i due non dimostra risparmio a parità di lavoro.

Le prove funzionali dimostrano ricezione senza tools/call MCP, backlog con zero inferenze prima del prompt, persistenza dopo riavvio dello stesso UUID, gestione di duplicati e testo ostile. Cinque ulteriori repliche con sei job mantengono un piano unico e nessun lavoro inutile dopo la submission. Un fatto casuale viene utilizzato con iniezione e resta sconosciuto senza iniezione: zero tools/call MCP in entrambi. È un'ablazione di questo harness, non una prova di impossibilità per altre architetture.

GitHub: tredici workflow remoti corretti, con successi, fallimenti e cancellazioni. Sei coppie valide, due per esito, più una baseline non abbinata. In N il server non interroga lo stato GitHub: usa il webhook e l'attesa sul filesystem. La cancellazione automatica della fixture è conteggiata separatamente. La schedulazione e i ritardi di cancellazione sono variabili: i confronti temporali GitHub sono esplorativi. Il dispatch iniziale respinto HTTP 422, i sorgenti prima/dopo e un preflight fallito prima delle inferenze sono conservati.

Costo totale stimato: **$6.0590** — API $5.9630, runner $0.0960. Nessuna riserva non confermata; limite $100 rispettato. Sono stime tariffarie, non una fattura.

Validazione: 36 test automatici e l'integrazione Pi passati; test del webhook passato anche dopo la modifica del preflight. Webhook rimossi e tunnel fermato.

Usare le notifiche per fatti esterni inattesi e risultati che arrivano durante altro lavoro; filtrare il rumore e inviare sintesi con riferimento agli artifact. Per la sola attesa di un risultato, W resta un controllo forte. L'estensione non risveglia l'agent e non riceve HTTP mentre il processo Pi è spento; riceve mentre Pi è aperto ma inattivo. I worker locali attendono realmente durate controllate; non rappresentano una CI di produzione. Le modifiche ai file, i test e i workflow GitHub sono reali.

- [Overview interattiva](overview.html)
- [CSV](results.csv)
- [JSON e tracce](results.json)
- [Controllo del canale](utility-negative-control.json)
- [Correzione adapter GitHub](github-adapter-repair.json)
- [Repository privato](https://github.com/gabry848/pi-notifications-bench-20261006)
