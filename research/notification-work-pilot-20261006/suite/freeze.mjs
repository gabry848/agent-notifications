import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const directory=import.meta.dirname;
const files=['design.md','generate.mjs','oracle.mjs','diagnostic.mjs'];
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const frozen={schemaVersion:1,id:'concurrent-pipeline-3pi-v1',frozenAt:new Date().toISOString(),status:'awaiting_transport_and_GO',paidInferenceBeforeFreeze:0,explorerOutcomesUsed:false,
  hypothesis:'Runtime facts may improve awareness/actions while three Pi agents implement useful independent work; end-only receipt is a control.',
  instanceSeed:20261006,modes:['PA','N','W'],modeOrder:['PA','N','W'],groups:3,agentsPerGroup:3,roles:['ingest','delivery','view'],maxPiSessions:9,maxEstimatedApiEquivalentUsd:4,targetUsefulMinutesApprox:10,durationForced:false,
  defaultPiModelRequired:true,providerOverrideForbidden:true,recordActualProviderModel:true,actualSubscriptionCostKnown:false,apiEquivalentEstimateMustBeLabeled:true,
  notificationProfile:{prompt:'v3',position:'tail',dismiss:'batch',providerCacheOverride:false},
  eventTriggers:[{id:'contract',trigger:'first effective view module write',targets:['view'],datum:{maxMessageChars:192},actionExpected:'update view POLICY and validate rendering while other work may remain'},
    {id:'receipt',trigger:'first successful role test verification',targets:['ingest','delivery','view'],datum:'actual dataset SHA256',actionExpected:'report at end, no code dependency'},
    {id:'noise',trigger:'contract publication',targets:['ingest','delivery','view'],datum:'unrelated cafeteria availability',actionExpected:'ignore without edits or blocking'},
    {id:'coordination',trigger:'actual board message/activity mutation',targets:'recipient or subscribed project actors',datum:'persisted real Coordinator revision',actionExpected:'appropriate collaboration, not automatic authority'}],
  paBackoffSeconds:[2,4,8,16,30],wCompetitive:true,nNoStatusOrAwaitWhileUsefulWork:true,boardChecksBeforeSharedEditsAllModes:true,
  concurrency:'3 Pi per group; groups isolated from other measured Pi workloads',
  oracle:{contractTests:19,preserveTests:true,preserveSharedExports:true,policy:192,finalReceipt:true,handoffAllRoles:true,actorScopeAndCleanupTraceChecks:true},
  requiredMetricFamilies:['task_correctness','verified_overlap','producer_to_exposure','producer_to_first_useful_action','whole_turn_and_submission','model_http_attempts','tokens_with_cache','native_and_mcp_tool_calls','board_and_queue_checks','api_equivalent_dollars','fallback_await','lost_edits_or_conflicts','cleanup'],
  sourceHashes:Object.fromEntries(files.map(f=>[f,sha(join(directory,f))])),
  transportMapping:'Must be appended as a separate runtime manifest before GO; workload/oracle hashes cannot silently change.',
  interpretation:'One instance per mode. Include incomplete/failed attempts; no 30–60 minute extension without user review.'};
writeFileSync(join(directory,'suite-frozen.json'),JSON.stringify(frozen,null,2));console.log(JSON.stringify({id:frozen.id,frozenAt:frozen.frozenAt,sourceHashes:frozen.sourceHashes},null,2));
