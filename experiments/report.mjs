import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SCENARIOS } from './scenarios.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const campaigns = option('campaigns', 'baseline-final-v1,refined-v2').split(',');
const output = resolve(option('output', 'artifacts/overview.html'));
const data = campaigns.map(name => JSON.parse(readFileSync(resolve('artifacts', name, 'summary.json'), 'utf8')));
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const results = data.flatMap(d => d.results.map(r => ({ ...r, campaign: r.campaign ?? d.campaign })));
const technicalErrors = data.flatMap(d => (d.attempts ?? []).filter(r => r.error));
const count = (items, key) => `${items.filter(r => r.assessment[key]).length}/${items.length}`;
const rows = SCENARIOS.flatMap(name => data.flatMap(d => {
  const items = d.results.filter(r => r.name === name);
  if (!items.length) return [];
  return [`<tr><td>${escape(name)}</td><td>${escape(d.prompt)}</td><td>${count(items, 'injectionPass')}</td><td>${count(items, 'behaviorPass')}</td><td>${items.filter(r => r.error).length}</td></tr>`];
})).join('');
const details = results.map(r => `<details><summary>${escape(r.prompt)} · ${escape(r.name)} · prova ${r.repetition} — ${r.error ? 'errore di esecuzione' : r.assessment.behaviorPass ? 'esito atteso' : 'esito diverso'}</summary>
<p><strong>Notifiche inviate</strong></p><pre>${escape(r.notifications.map(n => `[${n.source}] ${n.message}`).join('\n'))}</pre>
<p><strong>Piano salvato</strong></p><pre>${escape(JSON.stringify(r.result, null, 2))}</pre>
<p><strong>Risposta osservata</strong></p><pre>${escape(r.assistantText)}</pre>
<p><strong>Esposizioni e dismiss</strong></p><pre>${escape(JSON.stringify(r.assessment.exposure, null, 2))}</pre>
${r.error ? `<p class="error">${escape(r.error)}</p>` : ''}
<p><a href="${escape(`${r.campaign}/${r.name}-${r.repetition}/summary.json`)}">Traccia sintetica JSON</a></p></details>`).join('');
const idle = results.filter(r => r.name === 'idle');
const hostile = results.filter(r => r.name === 'hostile');
const finalPrompt = readFileSync(resolve('prompts', `${data.at(-1).prompt}.txt`), 'utf8');
const refinedCases = new Set(data.at(-1).results.map(r => `${r.name}:${r.repetition}`));
const baselineMatched = data[0].results.filter(r => refinedCases.has(`${r.name}:${r.repetition}`) && !r.assessment.lifecycleExplicitlyRequested);
const refinedMatched = data.at(-1).results.filter(r => !r.assessment.lifecycleExplicitlyRequested);
const cleanup = items => `${items.filter(r => r.assessment.exposure.length && r.assessment.exposure.every(n => n.dismissed)).length}/${items.length}`;
const transcriptChecks = results.filter(r => r.transcriptBlockPersisted !== null && r.transcriptBlockPersisted !== undefined);
const html = `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pi · Dynamic Notification Memory</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:1000px;margin:48px auto;padding:0 24px;color:#182535;background:#f7f9fc}h1{font-size:34px;line-height:1.2}h2{margin-top:36px}table{width:100%;border-collapse:collapse;background:white}th,td{text-align:left;padding:12px;border-bottom:1px solid #dce3ee}th{background:#eaf0f8}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#edf1f7;padding:16px;border-radius:8px;font-size:13px}details{background:white;border:1px solid #dce3ee;border-radius:8px;margin:10px 0;padding:14px}summary{cursor:pointer;font-weight:600}.error{color:#a52b36}.lead{font-size:19px}.stat{display:inline-block;margin:4px 12px 4px 0;padding:12px 18px;background:#e7edf8;border-radius:8px}small{color:#52647b}</style>
<h1>Pi: notifiche dinamiche nel contesto</h1>
<p class="lead">Prove reali di ricezione, reazione e gestione delle notifiche, con raffinamento del prompt. Nessun confronto con polling, token o numero di tool call.</p>
<p><small>${escape(data[0].provider)}/${escape(data[0].model)} · thinking ${escape(data[0].thinking)} · Pi 0.99.2 · ${results.length} prove nelle campagne riportate</small></p>
<p><span class="stat">Iniezione verificata: ${count(results, 'injectionPass')}</span><span class="stat">Comportamento atteso: ${count(results, 'behaviorPass')}</span></p>
${technicalErrors.length ? `<p>${technicalErrors.length} tentativi precedenti sono rimasti incompleti per errori runtime. Sono conservati negli artifact e nella provenienza della campagna; la tabella usa l'ultimo tentativo di ciascun caso, senza attribuire gli errori tecnici al comportamento del modello.</p>` : ''}
<h2>Risultati</h2><table><thead><tr><th>Scenario</th><th>Prompt</th><th>Iniezione</th><th>Comportamento</th><th>Errori runtime</th></tr></thead><tbody>${rows}</tbody></table>
<p>Le prove di iniezione controllano il payload effettivamente preparato per il provider, la prima esposizione e l'unicità del blocco. Gli esiti comportamentali confrontano il piano salvato con criteri fissati prima della prova.</p>
<p>Pi fermo: ${idle.filter(r => r.idleVerified).length}/${idle.length} prove senza una richiesta avviata dall'evento nell'intervallo osservato di un secondo. Istruzioni ostili: ${count(hostile, 'behaviorPass')} piani conformi alla richiesta dell'utente.</p>
<h2>Come leggere gli esiti</h2><p>La notifica è una memoria disponibile alla prossima chiamata, non un meccanismo di risveglio. Un dismiss elimina il dato dalla sezione dinamica; risposte e risultati di tool precedenti possono ancora citarlo nella conversazione.</p>
<p>Il test dismiss/history include una richiesta esplicita dell'utente di esercitare il lifecycle. Il suo esito non dimostra una capacità autonoma di pulizia del contesto. L'esposizione ripetuta e il dismiss spontaneo sono visibili nelle tracce.</p>
<p>Pi converte i messaggi custom in messaggi user per il provider. Il prompt e l'involucro delimitato chiariscono l'autorità dei dati; questa campagna non dimostra una separazione dei ruoli imposta dal trasporto.</p>
<h2>Raffinamento osservato</h2><p>Il prompt iniziale spiegava la presenza dei dati, ma lasciava impliciti i criteri di dismiss. La versione finale chiarisce vincoli dell'utente, gestione dei conflitti, significato dell'età, assenza di obbligo di menzionare eventi irrilevanti e pulizia dopo l'uso.</p>
<p>Negli stessi casi selezionati per la seconda passata, le notifiche risultano tutte dismissate spontaneamente in ${cleanup(baselineMatched)} prove con v1 e ${cleanup(refinedMatched)} con v2. Questa misura riguarda il lifecycle, non confronta il numero di tool call. La correttezza del piano resta riportata separatamente nella tabella.</p>
<p>Verifica del transcript effettivo via RPC: ${transcriptChecks.filter(r => !r.transcriptBlockPersisted).length}/${transcriptChecks.length} prove controllate senza persistenza del blocco dinamico.</p>
<h2>Prompt finale</h2><pre>${escape(finalPrompt)}</pre>
<h2>Limiti</h2><p>Un solo modello, tre ripetizioni per scenario, task di deployment simulati e tool del laboratorio. Non sono stati eseguiti deployment, webhook GitHub reali o misure comparative di prestazioni. Le reazioni testuali richiedono lettura qualitativa oltre al controllo del piano JSON.</p>
<h2>Prove e risposte</h2>${details}</html>`;
writeFileSync(output, html);
console.log(output);
