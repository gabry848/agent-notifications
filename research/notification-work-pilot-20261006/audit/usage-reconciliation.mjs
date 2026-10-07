import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { normalizeUsage, estimate, reserveAmount } from '../adapter/frozen/meter.mjs';

const campaign = resolve(import.meta.dirname, '..');
const ledgerPath = join(campaign, 'budget.sqlite');
const lines = path => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
if (!existsSync(ledgerPath)) { console.log(JSON.stringify({status:'awaiting-first-provider-request'})); process.exit(0); }
const db = new DatabaseSync(ledgerPath, {readOnly:true});
const rows = db.prepare('SELECT * FROM pilot_requests ORDER BY started_at,id').all();
db.close();
const runPaths = [];
for (const area of ['explorer/runs','suite/traces']) {
  const base = join(campaign, area); if (!existsSync(base)) continue;
  for (const entry of readdirSync(base)) {
    const path = join(base, entry);
    if (existsSync(join(path, 'manifest.json'))) runPaths.push({runId:entry, path});
    for (const role of ['ingest','delivery','view']) if (existsSync(join(path,role,'meter.jsonl')))
      runPaths.push({runId:`suite-${entry.replace(/^group-/,'')}-${role}`,path:join(path,role)});
  }
}
const runs = runPaths.map(({runId,path}) => {
  const ledger = rows.filter(r=>r.run_id===runId);
  const meter = lines(join(path,'meter.jsonl'));
  const settled = ledger.filter(r=>r.state==='settled').map(row=>{
    const raw = JSON.parse(row.raw_usage), actual = JSON.parse(row.normalized_usage);
    const expected = normalizeUsage(raw), cost = estimate(expected);
    return {id:row.id,responseId:row.response_id,status:row.status,
      usage:actual,normalizationMatches:JSON.stringify(actual)===JSON.stringify(expected),
      estimateMatches:Math.abs(cost-row.estimated)<1e-12,
      reserveMatches:Math.abs(reserveAmount(row.payload_bytes)-row.reserved)<1e-12,
      costWithinReserve:cost<=row.reserved, outputWithinModelMaximum:actual.output<=128000,
      estimatedApiEquivalentUsd:row.estimated};
  });
  const sdkEvents = meter.filter(r=>r.type==='pi_message_usage');
  const zeroUsageErrors=sdkEvents.filter(r=>r.stopReason==='error'&&r.usage?.totalTokens===0);
  const sdk = sdkEvents.filter(r=>!(r.stopReason==='error'&&r.usage?.totalTokens===0)).map(r=>r.usage);
  const keys = ['input','output','cacheRead','cacheWrite','totalTokens'];
  const totals = entries => Object.fromEntries(keys.map(k=>[k,entries.reduce((sum,u)=>sum+(u[k]??0),0)]));
  const normalizedTotals = totals(settled.map(r=>r.usage)), sdkTotals = totals(sdk);
  const sdkEventsCaughtUp = settled.length===sdk.length;
  const sdkMatches = sdkEventsCaughtUp && keys.every(k=>normalizedTotals[k]===sdkTotals[k]);
  const httpCount = meter.filter(r=>r.type==='http_attempt').length;
  const model = meter.find(r=>r.type==='resolved_model');
  const wrongModel = !!model && (model.provider!=='openai-codex'||model.model!=='gpt-6.1-sol');
  return {runId,path,ledgerAttempts:ledger.length,traceHttpAttempts:httpCount,
    requestCountMatches:ledger.length===httpCount,settledCount:settled.length,
    unsettledCount:ledger.length-settled.length,unsettledReservedUsd:ledger.filter(r=>r.estimated===null).reduce((s,r)=>s+r.reserved,0),
    sdkMessageCount:sdkEvents.length,sdkMessagesWithModelUsage:sdk.length,
    sdkZeroUsageErrors:zeroUsageErrors.map(r=>({time:r.time,stopReason:r.stopReason,totalTokens:r.usage?.totalTokens})),
    sdkEventsCaughtUp,sdkUsageMatches:sdkMatches,
    normalizedTotals,sdkTotals,wrongModel,settled,
    accountingConsistent:!wrongModel&&ledger.length===httpCount&&settled.length>0&&settled.every(r=>r.normalizationMatches&&r.estimateMatches&&r.reserveMatches&&r.costWithinReserve&&r.outputWithinModelMaximum)&&sdkMatches,
  };
});
const result = {auditedAt:new Date().toISOString(),ledgerPath,readOnly:true,attempts:rows.length,
  apiEquivalentEstimatedUsd:rows.reduce((s,r)=>s+(r.estimated??0),0),
  reservedUnknownOrPendingUsd:rows.filter(r=>r.estimated===null).reduce((s,r)=>s+r.reserved,0),
  actualSubscriptionBillingUsd:null,runs};
writeFileSync(join(import.meta.dirname,'usage-reconciliation.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,runs:runs.map(({settled,...r})=>r)}));
