# Suite prefissata: una pipeline di consegna eventi, tre agent Pi

Questa suite è progettata indipendentemente dagli esiti dell'esploratore. È un pilot esplorativo con una sola istanza abbinata N/PA/W, non una conferma statistica. Non introduce attese artificiali per raggiungere dieci minuti.

## Lavoro verificabile

Tre sessioni Pi reali sviluppano contemporaneamente una piccola libreria Node di gestione eventi. Le aree sono vicine (`src/pipeline/`) e condividono `src/index.mjs`, il documento di integrazione e i contratti delle strutture dati.

- **ingest** implementa parsing, chiavi idempotenti, iscrizioni e routing dei destinatari; scrive i propri test e la propria sezione di integrazione.
- **delivery** implementa transizioni di consegna, retry deterministico, ack, selezione delle consegne dovute e riepilogo della coda; scrive i propri test e la propria sezione di integrazione.
- **view** implementa selezione del contesto, ordinamento, età `t-N`, compattazione e rendering; scrive i propri test e la propria sezione di integrazione.

Ogni ruolo ha lavoro indipendente sufficiente per procedere senza attendere gli altri. Ciascuno integra le proprie esportazioni nel file condiviso dopo una verifica corrente dei conflitti, coordina l'accesso con messaggi e conserva le esportazioni già presenti. Il Coordinator è una board: messaggi e assenza di conflitti non sono lock né autorizzazioni di scrittura. Le tracce salvano le versioni del file condiviso e gli hash prima/dopo: l'oracle rileva esportazioni perse, modifiche a file altrui e test incompatibili.

## Eventi durante il lavoro

La pubblicazione segue progressi reali, non timer per produrre una vittoria:

1. Le attività e i messaggi sono eventi del vero server Coordinator adattato. Gli agent annunciano interfacce, disponibilità per integrare e fine dell'area; il payload è identico nelle tre modalità.
2. Al primo cambiamento effettivo del modulo `view`, un processo esterno pubblica una revisione della policy: limite del testo del messaggio di **192 caratteri**. Prima della pubblicazione il valore non è nel prompt né nel workspace. Questa informazione è utile al rendering ma non impedisce agli altri ruoli di continuare.
3. Alla prima verifica positiva di un ruolo, il produttore calcola il digest SHA-256 di un dataset reale del fixture e pubblica una ricevuta. Il digest va riportato nella consegna finale, ma non cambia il codice: **controllo utile soltanto alla fine**.
4. Un aggiornamento irrilevante sulla disponibilità del servizio mensa è marcato come informativo senza relazione con il progetto. Non deve causare modifiche o blocchi.

Gli script sono processi locali effettivi; non fingono compilazioni o analisi da dieci minuti. Il carico principale è sviluppo, test e integrazione verificati. La durata finale viene registrata anche se molto più breve del target.

## Modalità e confronto

- **N:** gli aggiornamenti arrivano nel blocco runtime del contesto; nessuna lettura periodica degli eventi e nessun await mentre resta lavoro utile. Dismiss a gruppi dopo l'incorporazione; history soltanto per recupero motivato.
- **PA:** `get_updates` ai confini naturali con intervallo minimo crescente 2/4/8/16/30 secondi fra risposte senza novità. Il lavoro utile continua fra i controlli; non si impone una pausa artificiale se può proseguire.
- **W:** prosegue il lavoro indipendente e poi usa `await_next`, anche sul primo evento disponibile e con ritorno immediato per eventi già in coda. Prima di iniziare l'integrazione può ricevere un aggiornamento già disponibile; non è costretto ad attendere tutte le attività.

Tutte le modalità possono verificare lo stato corrente della board prima di scritture condivise, inviare messaggi e aggiornare l'attività. Quelle verifiche sono conteggiate separatamente dai controlli della coda degli eventi. I fatti e i destinatari sono identici; N non riceve fatti extra. Modello/provider sono il default effettivo di Pi e rimangono costanti. Il task non usa un modello fissato della vecchia campagna.

Ordine dei gruppi preregistrato: **PA, N, W**. Un gruppo contiene tre Pi concorrenti; i gruppi misurati si eseguono isolati dagli altri workload Pi sotto la stessa concorrenza. Se il trasporto supporta solo nomi o firme diversi, la mappatura è registrata e congelata prima di qualsiasi inferenza. Una capacità assente genera una variante esplicita, non una sostituzione silenziosa con una board inventata.

## Esiti e misure

Oracle: tutti i test di contratto e integrazione passano; ciascuna esportazione e sezione di handoff è conservata; policy 192 incorporata; digest finale corretto; rumore senza modifiche; attività chiuse; nessun file fuori scope cambiato. Una prova incompleta non conta come vittoria temporale.

Per ogni evento: timestamp del produttore, ricezione nel canale, prima esposizione e prima azione utile osservabile. Un messaggio informativo senza azione richiesta resta classificato così. Non si interpreta un cambio del contesto come prova di comprensione.

Overlap: verifica positiva di un modulo o mutazione che contribuisce a una versione poi verificata, mentre un'altra attività reale è ancora aperta; riportare intervallo, ruolo e prova, senza contare due volte il medesimo lavoro. Misurare anche lavoro dopo l'evento e prima della prima consultazione PA/W, controlli della board, consultazioni della coda, interferenze, retry, perdite di modifiche, await fallback e cleanup.

Tempi distinti: primo handoff valido, completamento dei tre ruoli, turno intero incluso cleanup, startup. Usage: richieste HTTP effettive, tentativi/retry, token input/output/cache/total, tool nativi e MCP. Costi stimati con tariffa del default verificata, delta in dollari oltre alle percentuali. Budget suite massimo **4 USD**, massimo **3 gruppi/9 sessioni Pi**, nessuna estensione a 30–60 minuti.

## Gate

Nessuna inferenza Pi prima del GO del coordinatore con trasporto congelato, preflight, contabilità del default e calendario. Il corpus/oracle è congelato prima di osservare risultati dell'esploratore. Eventuali correzioni dopo il freeze vengono numerate e motivate separatamente.
