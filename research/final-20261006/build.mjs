import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../..');
const inputs = new Map();
const readText = path => {
  const text = readFileSync(resolve(root, path), 'utf8');
  inputs.set(path, createHash('sha256').update(text).digest('hex'));
  return text;
};
const read = path => JSON.parse(readText(path));
const write = (name, value) => writeFileSync(resolve(directory, name), value);
const json = (name, value) => write(name, JSON.stringify(value, null, 2) + '\n');
const oldDir = 'artifacts/benchmark-real-20261006-r1';
const pilotDir = 'research/notification-work-pilot-20261006';
const cacheDir = 'research/cache-fix-20261006';
const old = read(`${oldDir}/results.json`);
const pilot = read(`${pilotDir}/audit/metrics.json`);
const pilotPublic = read(`${pilotDir}/report-data.json`);
const analysis = read(`${pilotDir}/coordinator-analysis.json`);
const cache = read(`${cacheDir}/metrics.json`);
const cacheReview = read(`${cacheDir}/coordinator-review.json`);
const tests = read(`${cacheDir}/tests-verification.json`);
const cacheVerification = read(`${cacheDir}/verification.json`);
const durableResume = read(`${cacheDir}/offline/durable-resume/assertions.json`);
const actions = read(`${pilotDir}/audit/contract-action-evidence.json`);
const guard = read(`${pilotDir}/audit/reservation-guard-diagnostic.json`);
const negative = read(`${oldDir}/utility-negative-control.json`);
const cacheSources = read(`${cacheDir}/source-hashes.json`);
for (const [path, expected] of Object.entries(cacheSources)) {
  if (createHash('sha256').update(readText(path)).digest('hex') !== expected) {
    throw new Error(`Cache delivery source changed: ${path}`);
  }
}
for (const path of [
  `${oldDir}/findings.md`, `${pilotDir}/adapter/report.md`, `${pilotDir}/explorer/report.md`,
  `${pilotDir}/suite/report.md`, `${pilotDir}/audit/report.md`, `${cacheDir}/report.md`,
  `${cacheDir}/experiments.md`, 'README.md', 'notification_research_plan_v2.md',
]) readText(path);

const sumTokens = rows => rows.reduce((s, r) => {
  for (const field of ['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning', 'totalTokens']) {
    s[field] = (s[field] ?? 0) + (r.tokens[field] ?? 0);
  }
  return s;
}, {});
const sumCost = rows => rows.reduce((s, r) => s + (r.estimatedApiEquivalentUsd ?? 0), 0);
const near = (a, b, label) => { if (Math.abs(a - b) > 1e-8) throw new Error(`Reconciliation failed: ${label}: ${a} != ${b}`); };
const requests = [];
const ledgers = [];
const ledgerSpecs = [
  [oldDir, 'historical', 'requests'], [pilotDir, 'work-pilot', 'pilot_requests'],
  [cacheDir, 'cache-fix', 'pilot_requests'],
  ...['benchmark-real-20261006', 'benchmark-preflight-20261006',
    'benchmark-budget-guard-20261006', 'benchmark-budget-guard-verified-20261006']
    .map(name => [`artifacts/${name}`, 'infrastructure', 'requests']),
];
for (const [dir, campaign, table] of ledgerSpecs) {
  const path = `${dir}/budget.sqlite`;
  const db = new DatabaseSync(resolve(root, path), { readOnly: true });
  const rows = db.prepare(`SELECT * FROM ${table}`).all();
  const publicRows = rows.map((r, index) => {
    const tokens = JSON.parse(r.normalized_usage ?? r.usage ?? 'null');
    if (!tokens) throw new Error(`Unreconciled usage: ${path} row ${index}`);
    const raw = r.raw_usage ? JSON.parse(r.raw_usage) : null;
    // Numeric raw usage only; no payload, headers, response IDs, reasoning text or auth.
    const rawCounts = raw ? Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'attribution')) : null;
    return { campaign, ledger: path, ordinal: index + 1, runId: r.run_id,
      phaseOrScope: r.phase ?? r.scope, state: r.state, httpStatus: r.status ?? null,
      startedAt: r.started_at ?? null, payloadBytes: r.payload_bytes ?? null,
      conservativeReservationUsd: r.reserved, estimatedApiEquivalentUsd: r.estimated ?? r.cost,
      tokens, rawProviderCounts: rawCounts, rawUsageReference: `${path} (${table}; row ${index + 1})` };
  });
  if (publicRows.some(r => r.state !== 'settled' || (r.httpStatus !== null && r.httpStatus !== 200))) {
    throw new Error(`Unsettled or failed HTTP: ${path}`);
  }
  const external = table === 'requests' ? db.prepare('SELECT * FROM external_costs').all() : [];
  db.close();
  const item = { campaign, path, httpAttempts: rows.length, tokens: sumTokens(publicRows),
    estimatedApiEquivalentUsd: sumCost(publicRows), unsettled: 0,
    externalRunnerRows: external, externalRunnerEstimatedUsd: external.reduce((s, r) => s + (r.cost ?? 0), 0) };
  ledgers.push(item); requests.push(...publicRows);
}
const ledger = key => ledgers.find(x => x.campaign === key);
near(ledger('historical').httpAttempts, old.runs.reduce((s, r) => s + r.metrics.providerAttempts, 0), 'historical HTTP');
near(ledger('historical').estimatedApiEquivalentUsd, old.costs.estimatedUsd, 'historical cost');
near(ledger('historical').tokens.totalTokens, old.runs.reduce((s, r) => s + r.metrics.tokens.totalTokens, 0), 'historical tokens');
near(ledger('work-pilot').httpAttempts, pilot.modelHttpAttempts, 'pilot HTTP');
near(ledger('work-pilot').tokens.totalTokens, pilot.tokens.totalTokens, 'pilot tokens');
near(ledger('work-pilot').estimatedApiEquivalentUsd, pilot.estimatedApiEquivalentUsd, 'pilot cost');
near(ledger('cache-fix').httpAttempts, cache.httpAttempts, 'cache HTTP');
near(ledger('cache-fix').estimatedApiEquivalentUsd, cache.totalEstimatedUsd, 'cache cost');

const rpcTools = path => {
  const byName = {};
  for (const line of readText(path).split('\n').filter(Boolean)) {
    const event = JSON.parse(line).event;
    if (event?.type === 'tool_execution_start') byName[event.toolName] = (byName[event.toolName] ?? 0) + 1;
  }
  return byName;
};
const runLedger = (campaign, runId) => requests.filter(r => r.campaign === campaign && r.runId === runId);
const coordinatorTools = new Set(['list_activities', 'upsert_activity', 'start_activity',
  'update_activity', 'finish_activity', 'post_message', 'list_messages', 'check_conflicts',
  'get_updates', 'await_next', 'cancel_wait']);
const runs = old.runs.map(r => ({ campaign: 'historical', runId: r.runId, phase: r.phase,
  scenario: r.scenario, seed: r.seed, mode: r.mode, provider: 'openai', model: r.configuration.model,
  thinking: r.configuration.thinking, variant: r.variant, position: r.position, cache: r.cache,
  payload: r.payload, dismiss: r.dismiss, contextEnabled: r.contextEnabled,
  completed: !r.error, correct: r.assessment.passed,
  intentionalNegativeControl: r.scenario === 'unsolicited-negative',
  error: r.error, failures: r.assessment.failures, originalAssessment: r.originalAssessment,
  metrics: r.metrics, verification: r.verification,
  sourceHashes: r.configuration.sourceHashes, promptHash: r.configuration.promptHash,
  source: `${oldDir}/${r.runId}/summary.json` }));

for (const mode of ['PA', 'N']) {
  const group = read(`${pilotDir}/suite/traces/group-${mode}/summary.json`);
  for (const p of group.participants) {
    const rows = runLedger('work-pilot', p.runId);
    const toolNames = rpcTools(`${pilotDir}/suite/traces/group-${mode}/${p.role}/rpc.jsonl`);
    runs.push({ campaign: 'work-pilot', runId: p.runId, phase: 'suite', scenario: p.role, mode,
      provider: pilot.defaultPi.provider, model: pilot.defaultPi.model, thinking: pilot.defaultPi.thinking,
      completed: p.ok, correct: true, correctnessScope: 'Group artifact oracle; completion tracked separately',
      intentionalNegativeControl: false, error: p.error ?? null,
      metrics: { wallMs: p.promptEnd.monoMs - p.promptStart.monoMs,
        startupMs: p.promptStart.monoMs - p.start.monoMs,
        providerAttempts: rows.length, tokens: sumTokens(rows), estimatedUsd: sumCost(rows),
        toolNames, toolCalls: Object.values(toolNames).reduce((s, n) => s + n, 0),
        mcpCalls: Object.entries(toolNames).reduce((s, [name, count]) => s + (coordinatorTools.has(name) ? count : 0), 0),
        statusChecks: toolNames.get_updates ?? 0, fallbackAwaits: toolNames.await_next ?? 0,
        dismissCalls: toolNames.notifications_dismiss ?? 0, historyCalls: toolNames.notifications_history ?? 0,
        cacheHitRate: sumTokens(rows).cacheRead / (sumTokens(rows).input + sumTokens(rows).cacheRead) },
      source: `${pilotDir}/suite/traces/group-${mode}/summary.json` });
  }
}
const explorerPath = `${pilotDir}/explorer/runs/${pilot.explorer.id}/summary.json`;
const explorer = read(explorerPath);
const er = runLedger('work-pilot', pilot.explorer.id);
runs.push({ campaign: 'work-pilot', runId: pilot.explorer.id, phase: 'explorer', scenario: 'delivery-hub', mode: 'N',
  provider: pilot.defaultPi.provider, model: pilot.defaultPi.model, thinking: pilot.defaultPi.thinking,
  completed: !explorer.error, correct: pilot.explorer.independentTaskPassed,
  originalCheckerPassed: pilot.explorer.originalAutomaticPassed, intentionalNegativeControl: false,
  error: explorer.error, metrics: { wallMs: pilot.explorer.turnMs, startupMs: explorer.timing.startupMs,
    totalWallMs: explorer.timing.totalMs, providerAttempts: er.length, tokens: sumTokens(er),
    estimatedUsd: sumCost(er), toolCalls: explorer.tools.total, toolNames: explorer.tools.byName,
    mcpCalls: explorer.tools.mcpCalls, statusChecks: explorer.events.getUpdates,
    fallbackAwaits: explorer.events.awaitCalls }, source: explorerPath });
for (const m of cache.metrics) {
  const rows = runLedger('cache-fix', m.id);
  near(sumTokens(rows).input + sumTokens(rows).cacheRead, m.input, `${m.id} input`);
  near(sumTokens(rows).cacheRead, m.cached, `${m.id} cached`);
  near(sumCost(rows), m.estimatedUsd, `${m.id} cost`);
  runs.push({ campaign: 'cache-fix', runId: m.id, phase: m.triplet, scenario: 'cache-isolation', mode: m.variant,
    provider: cache.nativeDefault.provider, model: cache.nativeDefault.model, thinking: cache.nativeDefault.thinking,
    completed: m.status === 'complete', correct: m.correct, intentionalNegativeControl: false, error: null,
    metrics: { wallMs: m.durationMs, providerAttempts: m.httpAttempts, tokens: sumTokens(rows),
      estimatedUsd: m.estimatedUsd, toolCalls: m.toolCalls, statusChecks: 0, fallbackAwaits: 0,
      dismissCalls: 0, historyCalls: 0, cacheHitRate: m.weightedCacheFraction }, source: m.source });
}
for (const r of runs) {
  const rows = runLedger(r.campaign, r.runId);
  near(rows.length, r.metrics.providerAttempts, `${r.runId} HTTP`);
  near(sumCost(rows), r.metrics.estimatedUsd, `${r.runId} cost`);
  near(sumTokens(rows).totalTokens, r.metrics.tokens.totalTokens, `${r.runId} tokens`);
}
for (const group of pilot.groups) {
  const actors = runs.filter(r => r.campaign === 'work-pilot' && r.phase === 'suite' && r.mode === group.mode);
  near(actors.reduce((s, r) => s + r.metrics.mcpCalls, 0), group.mcpModelToolCalls, `${group.mode} MCP tools`);
}
if (new Set(runs.map(x => `${x.campaign}/${x.runId}`)).size !== runs.length) throw new Error('Duplicate run');

const initial = [];
for (const name of ['smoke-v1', 'smoke-fixed-v1', 'baseline-v1', 'retry-v1', 'refined-v2']) {
  const path = `artifacts/${name}/summary.json`;
  const data = read(path);
  for (const r of data.results) initial.push({ campaign: name, case: r.name, repetition: r.repetition,
    prompt: r.prompt, provider: r.provider, model: r.model, startedAt: r.started, endedAt: r.finished,
    durationMs: Date.parse(r.finished) - Date.parse(r.started), notifications: r.notifications,
    error: r.error, injectionPassed: r.assessment.injectionPass, behaviorPassed: r.assessment.behaviorPass,
    historyPassed: r.assessment.historyPass, failures: [...r.assessment.injectionFailures, ...r.assessment.behaviorMismatches],
    providerPayloadChecks: r.assessment.providerChecks, exposure: r.assessment.exposure,
    tokens: null, costUsd: null, source: `artifacts/${name}/${r.name}-${r.repetition}/summary.json` });
}
const initialFinal = read('artifacts/baseline-final-v1/summary.json');
const coverage = {
  trackedCampaigns: ['historical', 'work-pilot', 'cache-fix'],
  measuredRuns: runs.length, httpAttempts: requests.length, tokens: sumTokens(requests),
  estimatedApiEquivalentUsd: sumCost(requests),
  externalRunnerEstimatedUsd: old.costs.external.estimatedUsd,
  combinedEstimatedUsd: sumCost(requests) + old.costs.external.estimatedUsd,
  actualBillingUsd: null, pendingOrUnknownReservationsUsd: 0,
  initialBehaviorAttemptsSeparate: initial.length,
  initialUsageIncludedInTrackedTotals: false, codexCoordinatorAndSubagentUsageIncluded: false,
  interpretation: 'Descriptive totals for three metered campaigns; not a pooled efficiency comparison or an invoice for all project work.',
};
const dataset = {
  generatedAt: new Date().toISOString(), title: 'Ricerca finale: notifiche dinamiche nel contesto di Pi',
  scope: 'Existing local artifacts only; no new model inference, jobs or benchmarks', coverage,
  campaigns: [
    { id: 'historical', label: 'Benchmark precedenti', runs: 270, ...ledger('historical'),
      status: '258 corretti; 11 fallimenti; 1 controllo negativo',
      provider: 'openai', cachePolicy: 'Explicit stable-prefix adapter in selected confirmation profile',
      efficiencyScope: 'Scenario-specific paired short-task comparisons; not native Codex journal' },
    { id: 'work-pilot', label: 'Pilot lavoro concorrente', runs: 7, ...ledger('work-pilot'),
      status: 'PA completo; N incompleto; W non eseguito', provider: pilot.defaultPi.provider, cachePolicy: 'Native cache; old request-local snapshots',
      efficiencyScope: 'Zero valid complete efficiency comparisons' },
    { id: 'cache-fix', label: 'Diagnosi e correzione cache', runs: 6, ...ledger('cache-fix'),
      status: '6 completi e corretti', provider: cache.nativeDefault.provider,
      cachePolicy: 'Native cache; fixed snapshots anchored to original prefix',
      efficiencyScope: 'Controlled cache behavior only; not productivity' },
  ],
  initial: { attempts: initial, consolidatedResults: initialFinal.results.map(r => ({
    campaign: r.campaign, case: r.name, repetition: r.repetition, behaviorPassed: r.assessment.behaviorPass,
    injectionPassed: r.assessment.injectionPass, error: r.error })),
    note: 'Consolidation selects 24 outcomes from 31 attempts; neither consolidation nor retries are counted twice. Initial smoke and refined attempts are separate. Numeric usage/cost were not reconciled for this stage.' },
  runs, requests, infrastructureLedgers: ledgers.filter(x => x.campaign === 'infrastructure'),
  historical: { groups: old.groups, comparisons: old.comparisons, conclusions: old.conclusions,
    selection: old.selected.selection, selectedProfile: { variant: old.selected.variant,
      position: old.selected.position, cache: old.selected.cache, payload: old.selected.payload,
      dismiss: old.selected.dismiss, promptHash: old.selected.promptHash },
    utilityControl: old.utilityControl, negativeControl: negative, limitations: old.limitations,
    costs: old.costs, githubAttempts: old.githubAttempts, githubPreflights: old.githubPreflights,
    githubRepair: old.githubRepair, preservedInfrastructureAttempts: old.preservedInfrastructureAttempts },
  pilot: { audit: pilot, publicSummary: pilotPublic, coordinatorAnalysis: analysis, actions, guard,
    explorer: { originalCheckerPassed: explorer.taskCorrect, independentTaskPassed: pilot.explorer.independentTaskPassed,
      tools: explorer.tools, events: explorer.events, timing: explorer.timing, work: explorer.work } },
  cache: { ...cache, coordinatorReview: cacheReview, tests, verification: cacheVerification, durableResume },
  metricDefinitions: {
    modelHttp: 'Every actual outbound model HTTP attempt, including provider retries; distinct from logical responses and tool calls.',
    toolCalls: 'Tool execution starts; calls to MCP, native tools, dismiss/history and waits remain distinguishable.',
    tokenTotal: 'Cumulative tokens over requests, including cached input and reread context; not unique conversation size.',
    nativeCacheFraction: 'cacheRead / (uncachedInput + cacheRead); historical cacheWrite also contributes to total input denominator.',
    historicalTurnTime: 'wallMs: prompt to verified end; totalWallMs additionally includes measured startup.',
    pilotTurnTime: 'Observed actor turn; group duration is the longest actor turn, not sum of overlapping durations.',
    cacheDuration: 'Short fixture episode duration; not a task-efficiency estimate.',
    reaction: 'Observable code action or structured submission, not private model understanding.',
    cost: 'Frozen tariff API-equivalent estimate, not subscription billing; reasoning tokens are within output.',
    unknown: 'Null means unavailable, not zero. Initial behavior stage and Codex coordinator/subagent usage are outside the tracked totals.',
  },
};
json('data.json', dataset);
const csv = (name, rows, columns) => {
  const cell = v => v === null || v === undefined ? '' : '"' + String(typeof v === 'object' ? JSON.stringify(v) : v).replaceAll('"', '""') + '"';
  write(name, columns.map(x => cell(x[0])).join(',') + '\n' + rows.map(row => columns.map(x => cell(x[1](row))).join(',')).join('\n') + '\n');
};
csv('runs.csv', runs, [
  ...['campaign', 'runId', 'phase', 'scenario', 'mode', 'provider', 'model', 'thinking', 'completed', 'correct', 'intentionalNegativeControl', 'error', 'source'].map(k => [k, r => r[k]]),
  ...['providerAttempts', 'toolCalls', 'mcpCalls', 'statusChecks', 'fallbackAwaits', 'dismissCalls', 'historyCalls', 'wallMs', 'totalWallMs', 'cacheHitRate', 'estimatedUsd'].map(k => [k, r => r.metrics[k]]),
  ...['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning', 'totalTokens'].map(k => [k, r => r.metrics.tokens[k]]),
]);
csv('requests.csv', requests, [
  ...['campaign', 'runId', 'ordinal', 'phaseOrScope', 'state', 'httpStatus', 'startedAt', 'payloadBytes', 'conservativeReservationUsd', 'estimatedApiEquivalentUsd', 'ledger'].map(k => [k, r => r[k]]),
  ...['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning', 'totalTokens'].map(k => [k, r => r.tokens[k]]),
]);
csv('comparisons.csv', old.comparisons, Object.keys(old.comparisons[0]).map(k => [k, r => r[k]]));
csv('initial-observations.csv', initial, Object.keys(initial[0]).map(k => [k, r => r[k]]));
json('source-manifest.json', { generatedAt: dataset.generatedAt,
  evidenceFiles: Object.fromEntries(inputs), ledgerTotals: ledgers,
  historicalArtifactsOverwritten: false, privatePayloadsIncluded: false });

const esc = v => String(v ?? '—').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const number = (v, digits = 0) => v == null ? '—' : Number(v).toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const usd = v => '$' + number(v, 7);
const link = path => '../../' + path;
const table = (headers, rows) => `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<${i ? 'td' : 'th scope="row"'}>${c}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const campaignTable = table(['Campagna', 'Pi / episodi', 'HTTP modello', 'Token cumulativi', 'USD equivalenti API', 'Esito'], dataset.campaigns.map(c => [esc(c.label), number(c.runs), number(c.httpAttempts), number(c.tokens.totalTokens), usd(c.estimatedApiEquivalentUsd), esc(c.status)]));
const cacheTable = table(['Terna', 'Variante', 'Durata', 'Input totale', 'Cached', 'Quota cached', 'USD equivalenti API'], cache.metrics.map(m => [esc(m.triplet), esc({ current: 'Iniezione precedente', baseline: 'Senza notifiche', journal: 'Prototipo journal', fixed: 'Correzione applicata' }[m.variant]), number(m.durationMs / 1000, 2) + ' s', number(m.input), number(m.cached), number(m.weightedCacheFraction * 100, 2) + '%', usd(m.estimatedUsd)]));
const pilotTable = table(['Gruppo', 'Pi', 'Turno massimo', 'HTTP', 'Tool totali', 'MCP', 'get_updates / await', 'Token', 'Cached', 'USD API', 'Esito'], pilot.groups.map(g => [esc(g.mode), g.actorCount, number(g.groupObservedTurnMs / 1000, 2) + ' s', g.modelHttpAttempts, g.totalToolCalls, g.mcpModelToolCalls, g.getUpdatesCalls + ' / ' + g.awaitCalls, number(g.tokens.totalTokens), number(g.cacheReadFraction * 100, 2) + '%', usd(g.estimatedApiEquivalentUsd), g.allTurnsCompleted ? 'Completo' : 'Incompleto: view interrotta']));
const actionTable = table(['Modalità', 'Canale', 'Esposizione dall’ack', 'Modifica corretta dall’ack', 'Turni peer aperti', 'Gruppo completo'], actions.cases.map(c => [esc(c.mode), esc(c.channel), number(c.exposureAfterAckMs / 1000, 3) + ' s', number(c.codeActionAfterAckMs / 1000, 3) + ' s', esc(c.openPeerTurnsAtAction.join(', ')), c.completedAllTurns ? 'Sì' : 'No']));
const perRequest = table(['Run', 'HTTP', 'Input totale', 'Cached', 'Output', 'USD API'], cache.metrics.flatMap(m => runLedger('cache-fix', m.id).map((r, i) => [esc(m.id), i + 1, number(r.tokens.input + r.tokens.cacheRead), number(r.tokens.cacheRead), number(r.tokens.output), usd(r.estimatedApiEquivalentUsd)])));
const groupsTable = table(['Fase / scenario / profilo', 'n / corretti', 'HTTP mediana', 'Tool mediana', 'Token mediana', 'Turno mediano', 'USD mediani'], old.groups.map(g => [esc(g.key), `${g.n} / ${g.passed}`, number(g.medianCalls, 1), number(g.medianToolCalls, 1), number(g.medianTokens, 1), number(g.medianWallSeconds, 2) + ' s', usd(g.medianCostUsd)]));
const compareTable = table(['Fase', 'Scenario', 'Controllo', 'Metrica', 'Coppie', 'Risparmio mediano', 'Risparmio %', 'CI 95% in unità della metrica', 'Evidenza'], old.comparisons.map(c => [esc(c.phase), esc(c.scenario), esc(c.reference), esc(c.metric), c.pairs, number(c.medianSaving, 7), number(c.medianSavingPct, 2) + '%', esc(JSON.stringify(c.ci95)), esc(c.evidence)]));
const initialTable = table(['Campagna', 'Caso', 'Replica', 'Durata', 'Iniezione', 'Comportamento', 'Errore'], initial.map(r => [esc(r.campaign), esc(r.case), r.repetition, number(r.durationMs / 1000, 2) + ' s', esc(r.injectionPassed), esc(r.behaviorPassed), esc(r.error)]));
const infraTable = table(['Campagna infrastrutturale', 'HTTP nel ledger', 'USD contabilizzati'], dataset.infrastructureLedgers.map(l => [esc(l.path), l.httpAttempts, usd(l.estimatedApiEquivalentUsd)]));
const confirmComparisons = old.comparisons.filter(c => c.phase === 'confirm' && ['providerAttempts', 'tokens.totalTokens', 'estimatedUsd', 'wallMs'].includes(c.metric));
const confirmTable = table(['Scenario', 'Controllo', 'HTTP risparmiati', 'Token risparmiati', 'Costo risparmiato', 'Tempo risparmiato'], [['S2', 'PA'], ['S2', 'W'], ['S6', 'P10'], ['S6', 'W']].map(([s, ref]) => [esc(s), esc(ref), ...['providerAttempts', 'tokens.totalTokens', 'estimatedUsd', 'wallMs'].map(k => number(confirmComparisons.find(c => c.scenario === s && c.reference === ref && c.metric === k).medianSavingPct, 2) + '%')]));
const replacements = { CAMPAIGN_TABLE: campaignTable, CACHE_TABLE: cacheTable, PILOT_TABLE: pilotTable,
  ACTION_TABLE: actionTable, CACHE_REQUESTS: perRequest, GROUPS_TABLE: groupsTable,
  COMPARISONS_TABLE: compareTable, INITIAL_TABLE: initialTable, INFRA_TABLE: infraTable,
  CONFIRM_TABLE: confirmTable, RUN_COUNT: number(coverage.measuredRuns), HTTP_COUNT: number(coverage.httpAttempts),
  TOKEN_COUNT: number(coverage.tokens.totalTokens), API_COST: usd(coverage.estimatedApiEquivalentUsd),
  COMBINED_COST: usd(coverage.combinedEstimatedUsd), SOURCE_COUNT: inputs.size,
  COMBINED_COST_SHORT: '$' + number(coverage.combinedEstimatedUsd, 2),
  SOURCE_LINKS: [
    [`${oldDir}/findings.md`, 'Benchmark precedenti'], [`${oldDir}/results.json`, 'Artifact originali dei 270 episodi'],
    [`${pilotDir}/adapter/report.md`, 'Adapter Coordinator reale'], [`${pilotDir}/explorer/report.md`, 'Esploratore'],
    [`${pilotDir}/suite/report.md`, 'Suite concorrente'], [`${pilotDir}/audit/report.md`, 'Audit del pilot'],
    [`${pilotDir}/coordinator-analysis.json`, 'Analisi del pilot'], [`${pilotDir}/audit/contract-action-evidence.json`, 'Evento → modifica del codice'],
    [`${pilotDir}/audit/reservation-guard-diagnostic.json`, 'Guardia di budget'], [`${cacheDir}/report.md`, 'Diagnosi della cache'],
    [`${cacheDir}/coordinator-review.json`, 'Revisione del coordinatore'], [`${cacheDir}/offline/durable-resume/assertions.json`, 'Ripresa offline della sessione'],
  ].map(([path, title]) => `<a href="${esc(link(path))}">${esc(title)}</a>`).join(''),
  EMBEDDED_DATA: JSON.stringify(dataset).replaceAll('<', '\\u003c'),
};
let html = readFileSync(resolve(directory, 'template.html'), 'utf8');
for (const [key, value] of Object.entries(replacements)) html = html.replaceAll(`@@${key}@@`, String(value));
if (/@@[A-Z_]+@@/.test(html)) throw new Error('Unresolved template placeholder');
for (const match of html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
const ids = [...html.matchAll(/\bid="([^\"]+)"/g)].map(x => x[1]);
if (new Set(ids).size !== ids.length) throw new Error('Duplicate HTML id');
json('data-verification.json', { status: 'pending' });
for (const match of html.matchAll(/\bhref="([^\"]+)"/g)) {
  const href = match[1];
  if (href.startsWith('#')) { if (!ids.includes(href.slice(1))) throw new Error(`Missing anchor ${href}`); }
  else if (!/^https?:/.test(href) && !existsSync(resolve(directory, href))) throw new Error(`Missing local link ${href}`);
}
const embedded = JSON.parse(html.match(/<script type="application\/json" id="research-data">([\s\S]*?)<\/script>/)[1]);
if (JSON.stringify(embedded) !== JSON.stringify(dataset)) throw new Error('Embedded JSON differs');
write('research.html', html);
json('data-verification.json', { generatedAt: new Date().toISOString(), allLedgersReconciled: true,
  allRunsReconciled: true, settledRequests: requests.length, measuredRuns: runs.length,
  initialAttemptsSeparate: initial.length, uniqueHtmlIds: true, allLocalLinksExist: true,
  scriptSyntaxValid: true, embeddedDataMatches: true, cacheDeliveryHashMismatches: [],
  originalArtifactsOverwritten: false, newModelInferences: 0, browserVerification: 'pending' });
console.log(JSON.stringify({ html: resolve(directory, 'research.html'), ...coverage }));
