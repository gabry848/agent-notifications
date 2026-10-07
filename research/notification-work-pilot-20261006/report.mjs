import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const directory = dirname(fileURLToPath(import.meta.url));
const read = file => JSON.parse(readFileSync(join(directory, file), 'utf8'));
const audit = read('audit/metrics.json');
const analysis = read('coordinator-analysis.json');
const action = read('audit/contract-action-evidence.json');
const guard = read('audit/reservation-guard-diagnostic.json');
const db = new DatabaseSync(join(directory, 'budget.sqlite'), { readOnly: true });
const rows = db.prepare('SELECT state,status,estimated,normalized_usage FROM pilot_requests').all();
db.close();
const ledger = rows.reduce((s, r) => {
  s.http++; s.tokens += JSON.parse(r.normalized_usage).totalTokens;
  s.estimate += r.estimated ?? 0;
  if (r.state !== 'settled' || r.status !== 200) s.unreconciled++;
  return s;
}, { http: 0, tokens: 0, estimate: 0, unreconciled: 0 });
if (ledger.http !== audit.modelHttpAttempts || ledger.tokens !== audit.tokens.totalTokens ||
    Math.abs(ledger.estimate - audit.estimatedApiEquivalentUsd) > 1e-9 || ledger.unreconciled) {
  throw new Error('The public report does not reconcile with the pilot ledger');
}
const groups = audit.groups.map(g => ({
  mode: g.mode, sessions: g.actorCount, completed: g.allTurnsCompleted,
  artifactPassed: g.artifactOraclePassed, turnSeconds: g.groupObservedTurnMs / 1000,
  http: g.modelHttpAttempts, totalTools: g.totalToolCalls, mcpTools: g.mcpModelToolCalls,
  getUpdates: g.getUpdatesCalls, await: g.awaitCalls, tokens: g.tokens,
  cacheFraction: g.cacheReadFraction, estimatedApiEquivalentUsd: g.estimatedApiEquivalentUsd,
}));
const data = {
  generatedAt: new Date().toISOString(), campaign: 'notification-work-pilot-20261006',
  status: 'partial-pilot-reservation-interruption', actualDefaultPi: audit.defaultPi,
  totals: { piSessions: audit.measuredPiSessions, http: ledger.http, tokens: ledger.tokens,
    estimatedApiEquivalentUsd: ledger.estimate, actualSubscriptionBillingUsd: null,
    pendingOrUnknownReservationsUsd: audit.unknownOrPendingReservedUsd, validEfficiencyComparisons: 0 },
  explorer: { sessions: 1, turnSeconds: audit.explorer.turnMs / 1000,
    http: audit.explorer.modelHttpAttempts, tokens: 120648,
    estimatedApiEquivalentUsd: audit.explorer.estimatedApiEquivalentUsd,
    rawAutomaticPassed: audit.explorer.originalAutomaticPassed,
    independentTaskPassed: audit.explorer.independentTaskPassed, getUpdates: 0, await: 0 },
  groups, actions: action.cases.map(c => ({ mode: c.mode,
    exposureSeconds: c.exposureAfterAckMs / 1000, codeActionSeconds: c.codeActionAfterAckMs / 1000,
    channel: c.channel, openPeerTurnsAtAction: c.openPeerTurnsAtAction, completed: c.completedAllTurns })),
  notificationLifecycle: analysis.notifications, toolStarts: analysis.toolStarts,
  observedCostDifference: analysis.observedCostDifference, cacheDiagnostic: analysis.cacheDiagnostic,
  reservationGuard: { scopeCapUsd: guard.scopeCapUsd, settledUsd: guard.settledEstimatedAtGuardUsd,
    pendingReserveUsd: guard.estimatedAndPendingAtGuardUsd - guard.settledEstimatedAtGuardUsd,
    newRequestReserveUsd: guard.newRequestReserveUsd, projectedUsd: guard.projectedScopeTotalUsd,
    providerRateLimit: false },
  laterWildcardChange: { includedInMeasuredPilot: false, single: { id: '*' }, batch: { ids: ['*'] },
    nodeTestsPassed: 39, piOfflineIntegrationPassed: true, largestVerifiedQueue: 3001,
    historyPreserved: true, sessionIsolationVerified: true, efficacyBenchmarkExecuted: false },
  references: ['adapter/report.md', 'explorer/report.md', 'suite/report.md', 'audit/report.md',
    'audit/metrics.json', 'coordinator-analysis.json', 'audit/contract-action-evidence.json',
    'audit/reservation-guard-diagnostic.json', 'audit/post-run-source-integrity.json'],
};
const number = (v, digits = 0) => v.toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const usd = v => `$${number(v, 6)}`;
const e = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const pa = groups.find(g => g.mode === 'PA'), n = groups.find(g => g.mode === 'N');
const runRow = (name, g, status, incomplete = false) => `<tr${incomplete ? ' data-incomplete="true"' : ''}><th scope="row">${name}</th><td>${status}</td><td>${g.sessions}</td><td>${number(g.turnSeconds, 1)} s</td><td>${number(g.http)}</td><td>${number(g.tokens.totalTokens ?? g.tokens)}</td><td>${usd(g.estimatedApiEquivalentUsd)}</td></tr>`;
const cell = (name, pv, nv) => `<tr><th scope="row">${name}</th><td>${pv}</td><td>${nv}</td></tr>`;
const html = `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Notifiche durante il lavoro — report del pilot</title>
<meta name="description" content="Pilot verificato: notifiche nel contesto di Pi, tre agent concorrenti, cache e guardia di budget. Risultati, limiti e prove.">
<style>
:root{--ink:#172e38;--muted:#53676f;--paper:#f3f4ef;--card:#fff;--line:#dce3df;--green:#176a52;--soft:#e7f4ec;--amber:#765014;--warn:#fff3dc;--blue:#155c81}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:var(--blue);text-underline-offset:3px}a:hover{text-decoration-thickness:2px}button{font:inherit;cursor:pointer}button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid var(--blue);outline-offset:4px}
.wrap{max-width:1100px;margin:auto;padding:0 28px}.mast{background:var(--ink);color:#fff;padding:62px 0 45px}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.17em;font-weight:700;color:#c4d5ce}.mast h1{font-size:clamp(34px,5.2vw,58px);line-height:1.1;letter-spacing:-.035em;margin:17px 0 22px;max-width:870px}.lead{font-size:20px;max-width:790px;color:#dbe6e1}.pills{display:flex;gap:10px;flex-wrap:wrap;margin-top:28px}.pill{border:1px solid #50696e;border-radius:999px;padding:5px 12px;font-size:12px;color:#d9e9df}.pill.ok{background:#22513f;border-color:#51886a}.pill.warn{color:#ffdfa0;background:#584620;border-color:#8d723c}
nav{position:sticky;top:0;background:#f3f4eff5;backdrop-filter:blur(10px);border-bottom:1px solid var(--line);z-index:5}.nav{display:flex;gap:24px;overflow:auto;white-space:nowrap;padding-top:14px;padding-bottom:14px}.nav a{font-size:13px;text-decoration:none;font-weight:650;color:var(--ink)}section{scroll-margin-top:85px;margin:43px 0}.section-head{display:flex;align-items:baseline;gap:12px}.section-no{font:600 12px ui-monospace,monospace;color:var(--green)}h2{font-size:27px;line-height:1.3;letter-spacing:-.025em;margin:0 0 20px}h3{font-size:17px;margin:0 0 10px}p{margin:0 0 14px}.muted,.caption{color:var(--muted)}.caption{font-size:13px;margin-top:13px}.card{background:var(--card);border:1px solid var(--line);border-radius:15px;padding:23px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:27px}.stat{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:19px}.stat strong{display:block;font-size:29px;letter-spacing:-.02em}.stat span{font-size:12px;color:var(--muted)}.callout{border-left:4px solid var(--green);background:var(--soft);padding:17px 20px;border-radius:0 9px 9px 0}.callout.warn{border-color:#c39842;background:var(--warn);color:#5c421b}.callout p:last-child{margin-bottom:0}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:12px;background:#fff}table{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}th,td{padding:13px 16px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}thead th{font-size:12px;background:#eaf0ed;color:var(--muted)}tbody th{font-weight:600}tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}tr[data-incomplete]{background:#fff8eb}[hidden]{display:none!important}.wide{min-width:800px}.controls{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:17px 0 12px}.controls button{background:#fff;border:1px solid #9eafa7;border-radius:8px;padding:8px 12px;font-size:13px;color:var(--ink)}.controls small{color:var(--muted)}details{border-top:1px solid var(--line);padding:15px 0}summary{font-weight:600;cursor:pointer}details>div{padding:15px 0 0}ul,ol{padding-left:22px;margin:9px 0 0}li{margin:7px 0}.list li{padding-left:4px}.flow{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:22px 0}.flow div{background:#edf3ef;border-radius:10px;padding:15px;font-size:13px}.flow b{display:block;color:var(--green);margin-bottom:4px}.code{background:#172e38;color:#e7efe9;padding:18px;border-radius:10px;font:13px/1.7 ui-monospace,SFMono-Regular,monospace;overflow:auto;white-space:pre}code{font-family:ui-monospace,SFMono-Regular,monospace;font-size:.87em;overflow-wrap:anywhere}.sources{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.sources a{display:block;background:#fff;border:1px solid var(--line);border-radius:10px;padding:13px 16px;font-size:14px;text-decoration:none}.sources a small{display:block;color:var(--muted)}footer{border-top:1px solid var(--line);margin-top:45px;padding:24px 0 40px;font-size:12px;color:var(--muted)}
@media(max-width:700px){.wrap{padding:0 18px}.mast{padding:38px 0 32px}.lead{font-size:18px}.metrics{grid-template-columns:1fr 1fr}.grid,.sources{grid-template-columns:1fr}.flow{grid-template-columns:1fr 1fr}.card{padding:19px}.controls{align-items:flex-start;flex-direction:column}.nav{gap:18px;padding:14px 18px}section{margin:34px 0}h2{font-size:24px}.stat strong{font-size:25px}}
@media print{body{background:#fff;font-size:10pt}.mast{background:#fff;color:var(--ink);padding:15px 0}.lead,.eyebrow{color:var(--muted)}.pill{color:var(--ink);border-color:var(--line)}nav,.controls{display:none}.wrap{max-width:none;padding:0}.card,.table-wrap{break-inside:avoid}.grid{display:block}.grid .card{margin:10px 0}.metrics{margin-top:15px}section{margin:24px 0}.sources{grid-template-columns:1fr 1fr}.wide{min-width:0}th,td{padding:8px}tr[data-incomplete][hidden]{display:table-row!important}footer{margin-top:15px}}
</style></head><body>
<header class="mast"><div class="wrap"><div class="eyebrow">Ricerca · Pi notifications · 6 ottobre 2026</div>
<h1>Le notifiche entrano nel lavoro.<br>Il risparmio resta da verificare.</h1>
<p class="lead">Un evento esterno è arrivato nel contesto di Pi e ha prodotto una modifica reale del codice mentre i peer lavoravano. Il pilot ha anche mostrato un limite del misuratore e un gap di cache da investigare.</p>
<div class="pills"><span class="pill ok">Iniezione e azione dimostrate</span><span class="pill warn">Benchmark parziale</span><span class="pill">Nessuna prova da 10–60 minuti</span></div></div></header>
<nav aria-label="Indice del report"><div class="wrap nav"><a href="#esito">Esito</a><a href="#percorso">Cosa è successo</a><a href="#dati">Dati</a><a href="#azione">Azione osservata</a><a href="#problemi">Problemi</a><a href="#wildcard">Dismiss *</a><a href="#prossimi">Prossimi passi</a><a href="#fonti">Prove</a></div></nav>
<main class="wrap">
<section id="esito"><div class="section-head"><span class="section-no">01</span><h2>Cosa possiamo affermare</h2></div>
<div class="grid"><div class="card"><h3>Verificato</h3><ul><li>SQLite conserva notifiche, ID, timestamp e stato della sessione.</li><li>Il server Coordinator reale può consegnare un fatto esterno senza una chiamata di recupero dell’agent.</li><li>Pi usa un fatto ricevuto per cambiare il codice durante un workflow concorrente.</li><li>Tre Pi modificano moduli vicini e completano gli artefatti verificati, preservando export e handoff.</li></ul></div>
<div class="card"><h3>Ancora da dimostrare</h3><ul><li>Riduzione complessiva di chiamate, token, tempo o costo.</li><li>Beneficio in sessioni da 10, 30 o 60 minuti.</li><li>Causa del diverso comportamento della cache.</li><li>Robustezza universale contro conflitti o perdita di aggiornamenti.</li></ul></div></div>
<div class="metrics"><div class="stat"><strong>${number(data.totals.piSessions)}</strong><span>sessioni Pi misurate</span></div><div class="stat"><strong>${number(data.totals.http)}</strong><span>HTTP modello riconciliati</span></div><div class="stat"><strong>${number(data.totals.tokens)}</strong><span>token cumulativi, cache inclusa</span></div><div class="stat"><strong>$${number(data.totals.estimatedApiEquivalentUsd, 2)}</strong><span>equivalenti API stimati</span></div></div>
<p class="caption">Token cumulativi sulle richieste, compreso contesto riletto. Le stime API non sono fatture della subscription Codex e non includono il runtime Codex dei subagent. Zero riserve ignote o pendenti; zero confronti di efficienza validi.</p></section>

<section id="percorso"><div class="section-head"><span class="section-no">02</span><h2>Cosa è successo</h2></div>
<p>Abbiamo spostato il focus dai task che devono solo aspettare un risultato al lavoro utile durante l’arrivo di eventi esterni. Quattro subagent Codex, con modello ereditato dal coordinatore e task AOVerview separati a dettaglio medio, hanno preparato e verificato il pilot.</p>
<div class="grid"><div class="card"><h3>1. Adapter Coordinator</h3><p>Adattata una copia isolata del vero server <code>gabry848/agent-coordination</code>. Board SQLite, eventi persistenti, outbox, routing per actor/sessione e ingresso HTTP idempotente. Quattro preflight passati, senza inferenze Pi.</p></div>
<div class="card"><h3>2. Esploratore</h3><p>Un Pi implementa un hub webhook con HTTP, SQLite, retry e policy ricaricabile. Termina in 3m32s, riceve e usa un evento senza polling/await. Il core era già completo quando l’evento arriva.</p></div>
<div class="card"><h3>3. Suite prefissata</h3><p>Tre Pi per gruppo lavorano su ingest, delivery e view: diciotto funzioni, export condivisi, integrazione e handoff. PA completa tutti i turni. N produce codice corretto ma view si interrompe. W non parte.</p></div>
<div class="card"><h3>4. Verificatore</h3><p>Controlla test, demo, scope, hash, usage e cleanup. Riconcilia tutti i 148 HTTP e distingue artefatti corretti, turno incompleto e azione osservabile. Nessuna nuova inferenza dell’auditor.</p></div></div>
<div class="flow" aria-label="Percorso di una notifica"><div><b>1 · Producer esterno</b>Pubblica un fatto</div><div><b>2 · Coordinator</b>Persiste evento e destinazione</div><div><b>3 · HTTP /notify</b>Salva nella sessione Pi</div><div><b>4 · Contesto</b>Inietta alla chiamata naturale successiva</div><div><b>5 · Agent</b>Applica il fatto al lavoro</div><div><b>6 · Dismiss</b>Rimuove dal contesto, conserva history</div></div>
<details><summary>Modello, confronti e condizioni di misura</summary><div><p>Pi ${e(audit.defaultPi.version)}, provider <code>${e(audit.defaultPi.provider)}</code>, modello <code>${e(audit.defaultPi.model)}</code>, thinking <code>${e(audit.defaultPi.thinking)}</code>: default effettivo di Pi, senza override del modello. I gruppi sono stati eseguiti in sequenza; all’interno di PA/N i tre Pi sono concorrenti.</p><p><strong>PA</strong> = polling adattivo con fallback di attesa consentito. <strong>N</strong> = notifiche nel contesto, con fallback finali/di integrazione registrati. <strong>W</strong> = controllo con attesa, pianificato ma non eseguito.</p><p>Trasporto SSE e retry automatici Pi disabilitati sono deviazioni comuni registrate. Nessuno schema cache API viene imposto al provider Codex. I fatti esterni prefissati sono equivalenti; i messaggi generati dagli agent sono esiti del lavoro e possono differire. Il producer è un harness locale controllato, non una GitHub Action remota da venti minuti.</p></div></details></section>

<section id="dati"><div class="section-head"><span class="section-no">03</span><h2>Dati osservati, senza ranking di efficienza</h2></div>
<div class="callout warn"><p><strong>N è incompleto.</strong> Meno chiamate o un turno più corto in questo episodio non provano un risparmio. Manca la conclusione di view; W non è stato misurato. I numeri restano utili per la diagnostica.</p></div>
<div class="controls"><small>Le durate sono dei turni Pi; avvio e cleanup non sono inclusi.</small><button id="toggle-incomplete" type="button" aria-pressed="true">Nascondi episodio incompleto</button></div>
<div class="table-wrap"><table class="wide" id="runs"><caption class="caption">Esecuzioni del pilot</caption><thead><tr><th>Esperimento</th><th>Esito</th><th>Pi</th><th>Turno massimo</th><th>HTTP modello</th><th>Token totali</th><th>USD equivalenti API</th></tr></thead><tbody>
${runRow('Esploratore · N', { ...data.explorer }, 'Corretto secondo audit')}
${runRow('Suite · PA', pa, 'Completo')}
${runRow('Suite · N', n, 'Interrotto localmente', true)}
<tr><th scope="row">Suite · W</th><td>Non eseguito</td><td>0</td><td>—</td><td>—</td><td>—</td><td>—</td></tr></tbody></table></div>
<p class="caption">Il checker originale dell’esploratore resta false: escludeva erroneamente <code>src/cli.mjs</code>. Una demo reale e 18 test passati nella verifica indipendente confermano il task. Il risultato grezzo non è stato riscritto.</p>
<div class="table-wrap"><table><caption class="caption">Diagnostica della suite: PA completo, N incompleto</caption><thead><tr><th>Metrica</th><th>PA</th><th>N · incompleto</th></tr></thead><tbody>
${cell('Tool totali', number(pa.totalTools), number(n.totalTools))}
${cell('Tool MCP del modello', number(pa.mcpTools), number(n.mcpTools))}
${cell('get_updates / await_next', `${pa.getUpdates} / ${pa.await}`, `${n.getUpdates} / ${n.await}`)}
${cell('Input non cached', number(pa.tokens.input), number(n.tokens.input))}
${cell('Cache letta / input totale', `${number(pa.cacheFraction * 100, 2)}%`, `${number(n.cacheFraction * 100, 2)}%`)}
${cell('Token output', number(pa.tokens.output), number(n.tokens.output))}
</tbody></table></div>
<p class="caption">Le tool call e le HTTP al modello sono misure distinte: una risposta può richiedere più tool. La quota cache è ponderata sui token input, non la percentuale di richieste con almeno un cache hit.</p></section>

<section id="azione"><div class="section-head"><span class="section-no">04</span><h2>Una notifica cambia davvero il codice</h2></div>
<div class="callout"><p>View in N riceve la policy esterna nel contesto e modifica <code>POLICY</code> con i turni ingest/delivery ancora aperti. Per questo fatto view non chiama <code>get_updates</code>, <code>list_messages</code> o <code>await_next</code>. È la prova operativa centrale del pilot.</p></div>
<div class="table-wrap" style="margin-top:18px"><table><caption class="caption">Un evento per modalità; intervalli dalla conferma al produttore</caption><thead><tr><th>Modalità</th><th>Canale</th><th>Prima esposizione</th><th>Modifica corretta del codice</th></tr></thead><tbody>
${data.actions.map(c => `<tr><th scope="row">${c.mode}${c.completed ? '' : ' · episodio incompleto'}</th><td>${c.mode === 'N' ? 'Iniezione nel contesto' : 'get_updates'}</td><td>${number(c.exposureSeconds, 2)} s</td><td>${number(c.codeActionSeconds, 2)} s</td></tr>`).join('')}
</tbody></table></div>
<p class="caption">Questi singoli tempi non dimostrano una vittoria generalizzabile. L’esposizione non prova da sola comprensione: la prova è la modifica verificata. Un turno peer aperto non prova calcolo continuo. L’arrivo non avvia una nuova inferenza e non interrompe quella corrente.</p></section>

<section id="problemi"><div class="section-head"><span class="section-no">05</span><h2>Problemi emersi e cosa significano</h2></div>
<div class="grid"><div class="card"><h3>Riserve concorrenti troppo rigide</h3><p>Il cap suite è $6. Al momento del blocco: ${usd(data.reservationGuard.settledUsd)} già contabilizzati + ${usd(data.reservationGuard.pendingReserveUsd)} riservati per due HTTP in corso + ${usd(data.reservationGuard.newRequestReserveUsd)} per la nuova richiesta = <strong>${usd(data.reservationGuard.projectedUsd)}</strong>.</p><p>La nuova HTTP viene bloccata prima dell’invio. Le riserve considerano output fino a 128k token; la stima finale dell’intera suite è $1,675294. Nessun 429, nessun superamento di $6 di spesa osservata.</p><p class="muted">Occorre attendere capacità disponibile con deadline e stessa politica per tutte le modalità, mantenendo il cap.</p></div>
<div class="card"><h3>La cache è la priorità economica</h3><p>N legge molto più input senza cache: 486.810 token contro 122.473. Il maggior costo stimato osservato è <strong>$0,669825</strong>.</p><p>Contributi: +$0,728674 da input non cached, −$0,075789 da cache letta, +$0,016940 da output. La differenza non dipende da cento token aggiunti.</p><p class="muted">La serializzazione sintetica offline mantiene le notifiche in coda. Questo non ricostruisce i payload reali e non stabilisce la causa del gap.</p></div>
<div class="card"><h3>Gestione, rumore e reiniezioni</h3><p>N registra 72 consegne, 66 ID esposti, 155 apparizioni e 89 reiniezioni. I sei eventi residui arrivano dopo l’ultimo snapshot e restano persistiti; nessuna prova di perdita.</p><p>I <strong>17 dismiss erano già multipli</strong>: rimuovono 66 ID, con batch fino a 9. N usa inoltre una history. Eliminare il recupero periodico può introdurre altre operazioni di gestione.</p><p class="muted">Aggregare aggiornamenti ridondanti e allineare il cursor fra notifiche e fallback sono ipotesi da verificare.</p></div>
<div class="card"><h3>Il lavoro è finito troppo presto</h3><p>Le sessioni durano circa tre minuti e mezzo. Nell’esploratore tutte le 14 milestone pubbliche sono già passate prima della pubblicazione dell’evento; restano CLI, integrazione e documentazione.</p><p>La suite mostra verifiche durante turni peer aperti, ma non dimostra venti minuti risparmiati. I cinque await di N appartengono a integrazione/fine lavoro: è una modalità ibrida.</p><p class="muted">Serve manutenzione incrementale reale, con problemi e integrazioni ancora aperti quando arrivano gli eventi.</p></div></div>
<details><summary>Correzioni pre-run e controlli indipendenti</summary><div><p>Il valore futuro della policy compariva inizialmente nel prompt della suite: corretto prima delle inferenze, conservando snapshot ed emendamenti. Il controllo dopo i run trova uguali 12 hash adapter, 23 suite e 5 explorer. Export, rendering, scope, handoff e cleanup sono verificati.</p><p>Endpoint e processi del pilot sono chiusi; rimossi solo i link auth temporanei. L’attività di view N resta <code>testing</code> e il report finale manca, preservando la prova dell’interruzione. I check sugli edit condivisi sono coordinazione informativa, non lock atomici. Nessun cambio a server o board di produzione, push, PR o release.</p></div></details></section>

<section id="wildcard"><div class="section-head"><span class="section-no">06</span><h2>La modifica successiva: dismiss con *</h2></div>
<p>Dopo l’analisi abbiamo aggiunto <code>*</code> nell’estensione principale: rimuove tutte le notifiche attive della sessione in una chiamata, lasciandole nella history. La risposta restituisce il conteggio. Il selettore include gli eventi arrivati prima dell’esecuzione del tool, anche se non erano nell’ultimo snapshot.</p>
<pre class="code">notifications_dismiss({id: "*"})
// modalità batch
notifications_dismiss({ids: ["*"]})</pre>
<p><strong>39 test passati</strong>, più integrazione del vero tool Pi offline nelle due modalità, senza richieste al modello. Verificati 3.001 eventi, isolamento, storico, nuovi arrivi successivi, rollback e riavvio.</p>
<div class="callout warn"><p><strong>La modifica non era presente nel pilot misurato.</strong> I sorgenti congelati restano invariati. Il miglioramento sul numero di chiamate o sul costo deve essere misurato in una nuova variante.</p></div></section>

<section id="prossimi"><div class="section-head"><span class="section-no">07</span><h2>Come ripartire, in ordine</h2></div>
<ol class="list"><li><strong>Correggere il misuratore:</strong> riserva con attesa limitata, registrazione della coda e trattamento uguale per N/PA/W. Correggere il checker CLI mantenendo il negativo originale.</li><li><strong>Diagnosticare la cache:</strong> acquisire hash o copie private redatte dei payload reali; verificare prefix, chiavi e stabilità del contesto. La posizione in coda è necessaria da controllare, non una garanzia di hit.</li><li><strong>Raffinare il workflow:</strong> cursor condiviso per fatti già osservati, batch o wildcard per la pulizia, meno notifiche di stato ridondanti. Conservare i fatti irrisolti utili.</li><li><strong>Calibrare un task incrementale:</strong> manutenzione del vero Coordinator su una baseline chiaramente identificata. La proposta dell’esploratore deve distinguere il nuovo lavoro dalle capacità già sviluppate nell’adapter.</li><li><strong>Congelare e ripetere confronti completi:</strong> stessi fatti esterni, criteri di correttezza e modello; più repliche e ordine bilanciato. Passare a 30/60 minuti solo dopo aver verificato lavoro utile e risultati del nuovo pilot.</li></ol>
<p class="caption">Questa pagina consolida il lavoro svolto. Non avvia nuovi agent, inferenze o campagne lunghe. Il controllo W e la ripetizione N richiedono una nuova decisione sul pilot.</p></section>

<section id="fonti"><div class="section-head"><span class="section-no">08</span><h2>Prove e artifact</h2></div>
<div class="sources"><a href="adapter/report.md">Adapter reale<small>Contratto MCP, trasporto e preflight</small></a><a href="explorer/report.md">Esploratore<small>Calibrazione e proposta successiva</small></a><a href="suite/report.md">Suite consolidata<small>PA completo, N incompleto, W sospeso</small></a><a href="audit/report.md">Audit indipendente<small>Correttezza, usage, isolamento e limiti</small></a><a href="audit/contract-action-evidence.json">Evento → codice<small>Tempi e modifica operativa verificata</small></a><a href="audit/reservation-guard-diagnostic.json">Diagnosi della guardia<small>Spesa contabilizzata e riserve concorrenti</small></a><a href="coordinator-analysis.json">Analisi del coordinatore<small>Tool, mix economico e controllo ledger</small></a><a href="report-data.json">Dati di questa pagina<small>Snapshot pubblico compatto, senza log privati</small></a><a href="explorer/proposed-v3/PLAN.md">Proposta di manutenzione<small>Solo progettazione, non eseguita</small></a><a href="../../artifacts/benchmark-real-20261006-r1/research.html">Ricerca precedente<small>Campagna distinta: non inclusa nei totali di questo pilot</small></a></div></section>
</main><footer><div class="wrap">Pilot del 6 ottobre 2026 · Report generato da dati locali riconciliati · Pi ${e(audit.defaultPi.version)} / ${e(audit.defaultPi.provider)} / ${e(audit.defaultPi.model)} · Costi effettivi subscription non osservati.</div></footer>
<script type="application/json" id="report-data">${JSON.stringify(data).replaceAll('<', '\\u003c')}</script>
<script>const button=document.getElementById('toggle-incomplete');button.addEventListener('click',()=>{const show=button.getAttribute('aria-pressed')!=='true';document.querySelectorAll('#runs [data-incomplete]').forEach(row=>row.hidden=!show);button.setAttribute('aria-pressed',String(show));button.textContent=show?'Nascondi episodio incompleto':'Mostra episodio incompleto';});</script>
</body></html>`;
writeFileSync(join(directory, 'report-data.json'), JSON.stringify(data, null, 2) + '\n');
writeFileSync(join(directory, 'research.html'), html);
console.log(JSON.stringify({ report: join(directory, 'research.html'), ledgerVerified: true,
  piSessions: data.totals.piSessions, http: data.totals.http, validEfficiencyComparisons: 0 }));
