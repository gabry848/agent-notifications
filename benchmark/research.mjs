import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Render existing evidence only. This command never starts Pi or a paid run.
const templatePath = fileURLToPath(new URL('./research-template.html', import.meta.url));
const campaignPath = path.resolve(process.argv[2] || 'artifacts/benchmark-real-20261006-r1');
const report = JSON.parse(await readFile(path.join(campaignPath, 'results.json'), 'utf8'));
const frozen = JSON.parse(await readFile(path.join(campaignPath, 'confirmation-frozen.json'), 'utf8'));
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = (value, digits = 1) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
const confirm = report.runs.filter(r => r.phase === 'confirm');
if (confirm.length !== 60 || confirm.some(r => !r.assessment.passed || !r.verification.passed)) {
  throw new Error('The narrative requires the recorded 60/60 verified confirmation cohort.');
}
const groups = report.groups.filter(g => g.phase === 'confirm');
const phaseNames = {pilot:'Pilot',main:'Studio principale',refine:'Affinamento',confirm:'Conferma',utility:'Prove funzionali',github:'GitHub reale'};
const phaseOrder = ['pilot','main','refine','confirm','utility','github'];
const phases = phaseOrder.map(phase => {
  const runs = report.runs.filter(r => r.phase === phase);
  return `<div class="phase"><span>${esc(phaseNames[phase])}</span><strong>${runs.length}</strong><small>${runs.filter(r => r.assessment.passed).length} task corretti</small></div>`;
}).join('');
const references = {S2:'PA',S6:'P10'};
const metrics = [
  {key:'providerAttempts',label:'Richieste HTTP al modello'},
  {key:'tokens.totalTokens',label:'Token totali'},
  {key:'estimatedUsd',label:'Costo API stimato'},
  {key:'wallMs',label:'Tempo del turno completo'},
];
function comparison(scenario, reference, key) {
  const c = report.comparisons.find(c => c.phase === 'confirm' && c.scenario === scenario && c.reference === reference && c.metric === key);
  if (!c || c.pairs !== 10) throw new Error(`Missing ten-pair comparison: ${scenario}/${reference}/${key}`);
  return c;
}
const paired = Object.fromEntries(['S2','S6'].map(scenario => [scenario, Object.fromEntries([references[scenario],'W'].map(ref => [ref, Object.fromEntries(metrics.map(m => [m.key,comparison(scenario,ref,m.key)]))]))]));
const savingRows = ['S2','S6'].map(s => `<tr><th scope="row">${s === 'S2' ? 'Job di 90 s' : 'Diagnostica + rumore'}<small>N vs ${references[s]} · 10 coppie</small></th>${metrics.map(m => {
  const pct = paired[s][references[s]][m.key].medianSavingPct;
  return `<td class="${pct >= 0 ? 'positive':'negative'}">${pct > 0 ? '−' : '+'}${num(Math.abs(pct))}%<small>${pct >= 0 ? 'in meno':'in più'}</small></td>`;
}).join('')}</tr>`).join('');
const waitRows = ['S2','S6'].map(s => `<tr><th scope="row">${s} · N vs W</th>${metrics.map(m => {
  const pct = paired[s].W[m.key].medianSavingPct;
  return `<td>${pct > 0 ? '−' : pct < 0 ? '+' : ''}${num(Math.abs(pct))}%</td>`;
}).join('')}<td>Nessuna soglia superata</td></tr>`).join('');
const layouts = frozen.selected.selection.layout.map(l => `<tr><th scope="row">${l.position === 'tail' ? 'In coda':'Prima dell’input'}${l.position === 'tail' && l.cache === 'stable' ? ' <span class="tiny-tag">scelto</span>':''}</th><td>${l.cache === 'stable' ? 'Esplicita, prefisso stabile':'Implicita'}</td><td>${l.correct}/${l.n}</td><td>$${num(l.cost,5)}</td><td>${num(l.cacheHitRate * 100)}%</td></tr>`).join('');
const githubRuns = report.runs.filter(r => r.phase === 'github' && r.githubEvidence?.run?.url);
const ghRows = githubRuns.map(r => `<tr><th scope="row"><a href="${esc(r.githubEvidence.run.url)}" target="_blank" rel="noopener">${esc(r.githubEvidence.run.runId)} ↗</a></th><td>${esc(r.githubEvidence.run.conclusion)}</td><td>${esc(r.mode)}</td><td>${r.seed}</td><td>${r.metrics.externalApiInvocations}</td><td><a href="${esc(r.runId)}/summary.json">Traccia</a></td></tr>`).join('');
const utility = Object.fromEntries(report.runs.filter(r => r.phase === 'utility').map(r => [r.scenario, `${r.runId}/summary.json`]));
const data = {groups,paired,references};
const replacements = {
  TOTAL: report.runs.length,
  CORRECT: report.runs.filter(r => r.assessment.passed).length,
  ESTIMATED_TOTAL: num(report.costs.conservativeTotalUsd,2),
  ESTIMATED_API: num(report.costs.estimatedUsd,4),
  ESTIMATED_RUNNER: num(report.costs.external.estimatedUsd,4),
  PHASES: phases,
  SAVING_ROWS: savingRows,
  WAIT_ROWS: waitRows,
  LAYOUT_ROWS: layouts,
  GH_ROWS: ghRows,
  GH_COUNT: githubRuns.length,
  MODEL: esc(report.campaign.model),
  RAW_DATA: JSON.stringify(data).replace(/</g,'\\u003c'),
  ...Object.fromEntries(Object.entries(utility).map(([k,v]) => [`UTILITY_${k.toUpperCase().replaceAll('-','_')}`,esc(v)])),
};
let html = await readFile(templatePath, 'utf8');
html = html.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
  if (!(key in replacements)) throw new Error(`Unknown placeholder: ${key}`);
  return String(replacements[key]);
});
await writeFile(path.join(campaignPath,'research.html'),html);
console.log(`Research page: ${path.join(campaignPath,'research.html')} (${report.runs.length} recorded runs; no new inference)`);
