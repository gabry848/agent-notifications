import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const campaign = resolve(import.meta.dirname, '..');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const ready = json(join(campaign, 'adapter/ready.json'));
const actualHashes = Object.fromEntries(Object.keys(ready.sha256).map(name => [name, sha(join(ready.root, name))]));
const mismatches = Object.entries(ready.sha256).filter(([name, expected]) => actualHashes[name] !== expected);
if (mismatches.length) throw new Error('Frozen adapter mismatch: ' + JSON.stringify(mismatches));
const upstreamCopyEqual = sha(join(campaign, 'adapter/upstream/plugins/agent-coordination/scripts/agent_coordination_server.py')) === ready.origin.sha256;
if (!upstreamCopyEqual) throw new Error('Upstream provenance copy mismatch');
const explorerFiles = ['run.mjs','fixture.mjs','feed.mjs','feed-extension.ts','audit-worker.mjs'];
const explorerHashes = Object.fromEntries(explorerFiles.map(name => [name, sha(join(campaign, 'explorer', name))]));
const runnerSupportedRuntimeFiles = ['meter.mjs','meter-extension.ts','pi-runtime.mjs','transport/pi-extension.ts','transport/store.mjs','transport/http.mjs','transport/prompt-v3.txt'];
const runtimeHashes = Object.fromEntries(runnerSupportedRuntimeFiles.map(name => [name, actualHashes[name]]));
const ledgerPath = join(campaign, 'budget.sqlite');
const at = new Date().toISOString();
const gate = {
  schemaVersion: 1, auditedAt: at, verdict: 'approve-first-explorer-calibration-only',
  explorerCalibrationApproved: true, suiteApproved: false, paidCallsByAuditor: 0,
  ledgerPath, adapterOrigin: ready.origin, adapterHashes: actualHashes,
  adapterHashMismatches: mismatches, upstreamCopyEqual, explorerHashes,
  checks: {
    actualDefaultZeroInferencePreflight: json(join(campaign, 'explorer/offline/pi-zero-oSw94i/assertions.json')),
    frozenAdapterTwelveFilesMatched: true,
    producerToolAbsentFromModel: true,
    producerHttpTokenNotInPiEnvironment: true,
    notificationContextDisabledInPAandW: true,
    explorerNativeFileToolsPreserved: true,
    competitiveAwaitReturnsQueuedReportImmediately: true,
    publicTestsCannotBeChangedForAcceptedTask: true,
    retriesReservedAtActualFetch: true,
    unknownUsageRetainsFullReserve: true,
    cacheTokensSubtractedOnce: true,
    reasoningNotDoubleCounted: true,
    conservativeConcurrentScopeReservationTestPassed: true,
  },
  pendingRealChecks: ['First terminal provider usage must settle against Pi usage before another workload is authorized.', 'Actual duration, useful post-event work and complete task oracle.', 'Executable demo/CLI wiring: current automatic oracle checks static candidates only.'],
  suiteConcerns: [
    'Initial suite/run.mjs used adapter sources outside frozen/. A newer runtime manifest now uses frozen; confirm final hashes before suite GO.',
    'suite/prompt.mjs exposes future policy value 192. Remove it and preserve pre-run amendment evidence before suite GO.',
    'Check actor ownership of mutations and final shared-file edit attribution from runtime evidence; board activities are not locks.',
  ],
  interpretationLimits: [
    'Calibration is not a ten-minute or long-session result until observed duration proves it.',
    'Explorer corpus is public and available for independent analysis; this is not a proof that its derived facts are inaccessible by other tools.',
    'Report computation starts after synthetic implementation-progress gate and is short; no real twenty-minute external computation latency is tested.',
    'One first calibration has no comparative performance conclusion.',
    'Code and logs outside workspace are not hidden by an OS sandbox; task instructions supply cooperative isolation.',
    'API-equivalent estimates are not observed subscription billing.',
  ],
  references: ['adapter/traces/preflight-final.tap','adapter/traces/coordinator-rmW58X/assertions.json','explorer/offline/checks.json','suite/offline-oracle-validation.json'],
};
mkdirSync(import.meta.dirname, { recursive: true });
writeFileSync(join(import.meta.dirname, 'preflight-gate.json'), JSON.stringify(gate, null, 2));
const receipt = {
  schemaVersion:1, issuedAt:at, issuer:'independent-auditor-under-root-conditional-authorization',
  explorerAuthorized:true, scope:'explorer', firstCalibrationOnly:true,
  allowedCase:{mode:'N',kind:'compatibility',seed:4101}, maxNewMeasuredCases:1,
  ledgerPath, scopeCapUsd:2, globalCapUsd:10, runtimeRoot:ready.root,
  runtimeHashes, explorerHashes, adapterAllHashes:actualHashes,
  nextAuthorizationRequires:'Auditor and root must verify first actual usage settlement and calibration outcome.',
};
writeFileSync(join(import.meta.dirname, 'explorer-first-GO.json'), JSON.stringify(receipt,null,2));
console.log(JSON.stringify({verdict:gate.verdict,adapterFiles:Object.keys(actualHashes).length,explorerFiles:explorerFiles.length,upstreamCopyEqual,receipt:join(import.meta.dirname,'explorer-first-GO.json')}));
