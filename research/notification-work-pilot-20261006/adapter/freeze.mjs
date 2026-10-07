import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { ACCOUNTING, reserveAmount } from './meter.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const files=['upstream_server.py','coordinator_server.py','stdio_proxy.py','coordinator-extension.ts',
  'board-runtime.mjs','pi-runtime.mjs','meter.mjs','meter-extension.ts',
  'transport/store.mjs','transport/http.mjs','transport/pi-extension.ts','transport/prompt-v3.txt'];
const frozen=join(root,'frozen');const hashes={};
for(const file of files){const target=join(frozen,file);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(root,file),target);
  hashes[file]=createHash('sha256').update(readFileSync(target)).digest('hex');}
const upstream=JSON.parse(readFileSync(join(root,'traces/upstream-commit.json')));
const origin={repository:'https://github.com/gabry848/agent-coordination',commit:upstream.sha,license:'MIT',
  originalFile:'plugins/agent-coordination/scripts/agent_coordination_server.py',
  sha256:createHash('sha256').update(readFileSync(join(root,'upstream_server.py'))).digest('hex'),
  archiveSha256:createHash('sha256').update(readFileSync(join(root,'upstream.tar.gz'))).digest('hex')};
writeFileSync(join(root,'source-hashes.json'),JSON.stringify({createdAt:new Date().toISOString(),origin,files:hashes},null,2));
writeFileSync(join(root,'accounting.json'),JSON.stringify({...ACCOUNTING,scopeCaps:{adapter:2,explorer:2,suite:6},globalCap:10,
  simultaneousExample:{payloadBytes:80000,perRequestReserveUsd:reserveAmount(80000),threePiReserveUsd:3*reserveAmount(80000)},
  realFetchBodyMetered:'Actual uncompressed UTF-8 body, including zstd decode; no headers or credentials are logged',
  failures:'Unknown/retried requests retain reserve; guard failures mean incomplete infrastructure cases'},null,2));
writeFileSync(join(root,'ready.json'),JSON.stringify({ready:true,version:'notification-work-pilot-adapter-v1',
  preparedAt:new Date().toISOString(),realCoordinator:true,origin,root:frozen,
  entrypoints:{startDefaultPi:join(frozen,'pi-runtime.mjs'),startBoard:join(frozen,'board-runtime.mjs'),
    coordinatorExtension:join(frozen,'coordinator-extension.ts'),notificationExtension:join(frozen,'transport/pi-extension.ts'),
    meterExtension:join(frozen,'meter-extension.ts'),meter:join(frozen,'meter.mjs')},
  sha256:hashes,defaultPi:{provider:'openai-codex',model:'gpt-6.1-sol',thinking:'medium',version:'0.99.2'},
  preflight:{passed:4,total:4,command:'node --test research/notification-work-pilot-20261006/adapter/preflight.test.mjs',
    artifact:join(root,'traces/preflight-final.tap'),inferences:0,modelFacingPublishUpdate:false},
  scopes:{adapter:2,explorer:2,suite:6,global:10},capabilities:['real upstream board store','activity/message events atomic SQLite triggers',
    'explicit project+actor+Pi UUID+loopback URL subscriptions','revision identity','durable outbox retry',
    'idempotent copied native ingress','shared get_updates/await_next facts','immediate backlog read','bounded/cancellable condition await',
    'externally authorized publish_update excluded from Pi tools','provider-native cache','default Pi native file tools',
    'all HTTP SSE attempts budget guarded','raw usage and nominal cost distinct from subscription billing'],
  limits:['no production board/global configuration changed','no orchestration or hard file locks',
    'events do not wake inference or interrupt a tool','receiver must run; retry exhaustion after eight attempts stays failed in outbox',
    'subscription TTL at most7200s; unsubscribe cannot undo an already-in-flight successful POST',
    'upstream activity/message size is not truncated; payloads over ingress8000chars fail rather than fabricate success',
    'external published payload max6000chars and references recommended','no isolation against a malicious agent reading files outside its workspace',
    'single centraldaemon handles board mutations; external direct writes are unsupported during measurement',
    'transport=sse is explicit common deviation from Pi auto','actual subscription billing unavailable',
    'no paid smoke/performance claim in this preparation'],
  use:'See report.md for env, namespace, ledger, producer and cleanup contracts'},null,2));
console.log(JSON.stringify({ready:true,frozen,files:files.length,upstreamCommit:upstream.sha}));
