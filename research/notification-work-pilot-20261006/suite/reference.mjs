// Offline oracle validation only. Never copy this implementation into a measured workspace.
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generate } from './generate.mjs';

export const implementations = {
  ingest: `const clone=v=>structuredClone(v); const cmp=(a,b)=>a<b?-1:a>b?1:0;
export function parseEvent(raw){const v=typeof raw==='string'?JSON.parse(raw):raw;if(!v||typeof v!=='object'||Array.isArray(v))throw Error('object');for(const k of ['producer','entityId','topic'])if(typeof v[k]!=='string'||!v[k])throw Error(k);if(!Number.isInteger(v.revision)||v.revision<0)throw Error('revision');if(typeof v.occurredAt!=='string'||!Number.isFinite(Date.parse(v.occurredAt)))throw Error('date');if(!v.body||typeof v.body!=='object'||Array.isArray(v.body))throw Error('body');return {producer:v.producer,entityId:v.entityId,topic:v.topic,revision:v.revision,occurredAt:v.occurredAt,body:clone(v.body)};}
export function eventKey(e){return JSON.stringify([e.producer,e.entityId,e.revision]);}
export function normalizeSubscriptions(items){const m=new Map();for(const v of items){if(typeof v.sessionId!=='string'||!v.sessionId||!Array.isArray(v.topics)||v.topics.some(t=>typeof t!=='string'||!t))throw Error('subscription');const old=m.get(v.sessionId);m.set(v.sessionId,{sessionId:v.sessionId,topics:[...new Set([...(old?.topics??[]),...v.topics])].sort(cmp),active:!!old?.active||v.active!==false});}return [...m.values()].sort((a,b)=>cmp(a.sessionId,b.sessionId));}
export function recipientsFor(e,s){return normalizeSubscriptions(s).filter(v=>v.active&&(v.topics.includes('*')||v.topics.includes(e.topic))).map(v=>v.sessionId);}
export function newestByEntity(events){const m=new Map();for(const e of events){const k=JSON.stringify([e.producer,e.entityId]),old=m.get(k);if(!old||e.revision>old.revision||(e.revision===old.revision&&Date.parse(e.occurredAt)>Date.parse(old.occurredAt)))m.set(k,e);}return clone([...m.values()].sort((a,b)=>cmp(a.producer,b.producer)||cmp(a.entityId,b.entityId)));}
export function routeBatch(events,subscriptions){return newestByEntity(events).flatMap(event=>recipientsFor(event,subscriptions).map(target=>({target,event:clone(event)})));}
`,
  delivery: `const clone=v=>structuredClone(v);const cmp=(a,b)=>a<b?-1:a>b?1:0;
export function retryDelay(attempts,baseMs=100,capMs=10000){if(!Number.isInteger(attempts)||attempts<=0||!Number.isFinite(baseMs)||baseMs<=0||!Number.isFinite(capMs)||capMs<=0)throw Error('retry');return attempts>1024?capMs:Math.min(capMs,baseMs*2**(attempts-1));}
export function initialDelivery(eventKey,target,now){if(typeof eventKey!=='string'||!eventKey||typeof target!=='string'||!target||!Number.isFinite(now)||now<0)throw Error('delivery');return {id:JSON.stringify([eventKey,target]),eventKey,target,status:'pending',attempts:0,availableAt:now,updatedAt:now};}
export function transitionDelivery(state,action,now){if(!Number.isFinite(now)||now<0||now<state.updatedAt)throw Error('time');const s=clone(state);if(action==='attempt'&&['pending','retry'].includes(s.status)){s.status='sending';s.attempts++;}else if(action==='delivered'&&s.status==='sending')s.status='delivered';else if(action==='failed'&&s.status==='sending'){s.status='retry';s.availableAt=now+retryDelay(s.attempts);}else if(action==='ack'&&['delivered','acked'].includes(s.status))s.status='acked';else throw Error('transition');s.updatedAt=now;return s;}
export function dueDeliveries(states,now){return clone(states.filter(s=>['pending','retry'].includes(s.status)&&s.availableAt<=now).sort((a,b)=>a.availableAt-b.availableAt||cmp(a.id,b.id)));}
export function summarizeQueue(states){const o={pending:0,sending:0,retry:0,delivered:0,acked:0,total:states.length};for(const s of states){if(!Object.hasOwn(o,s.status)||s.status==='total')throw Error('status');o[s.status]++;}return o;}
export function mergeQueue(existing,incoming){const m=new Map();for(const s of [...existing,...incoming]){const old=m.get(s.id);if(!old||s.updatedAt>=old.updatedAt)m.set(s.id,s);}return clone([...m.values()].sort((a,b)=>cmp(a.id,b.id)));}
`,
  view: `export const POLICY={maxMessageChars:160};const cmp=(a,b)=>a<b?-1:a>b?1:0;
export function turnAge(call,receivedCall){if(!Number.isInteger(call)||call<0||!Number.isInteger(receivedCall)||receivedCall<0)throw Error('call');return Math.max(0,call-receivedCall);}
export function compactMessage(message,maxChars=POLICY.maxMessageChars){if(typeof message!=='string'||!Number.isInteger(maxChars)||maxChars<1)throw Error('message');return message.length<=maxChars?{text:message,truncated:false}:{text:message.slice(0,maxChars-1)+'…',truncated:true};}
export function visibleEvents(events,sessionId,call,limit=50){turnAge(call,0);if(!Number.isInteger(limit)||limit<0)throw Error('limit');if(!limit)return [];return events.filter(e=>e.target===sessionId&&e.dismissedAt==null&&e.receivedCall<=call).sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt)||cmp(a.eventId,b.eventId)).slice(-limit).map(e=>({...structuredClone(e),turnAge:turnAge(call,e.receivedCall)}));}
export function renderNotification(e,call){return '- ['+e.eventId+'] '+e.occurredAt+' t-'+turnAge(call,e.receivedCall)+' '+e.source+': '+compactMessage(e.message).text;}
export function renderContext(events,sessionId,call,limit=50){return visibleEvents(events,sessionId,call,limit).map(e=>renderNotification(e,call)).join('\\n');}
export function groupBySource(events){const o=Object.create(null);for(const e of events)(o[e.source]??=[]).push(e.eventId);return o;}
`,
};

const directory=process.argv[2]??join(import.meta.dirname,'offline-reference');
const created=generate(directory);
for(const [role,code] of Object.entries(implementations))writeFileSync(join(directory,'src/pipeline',`${role}.mjs`),code);
writeFileSync(join(directory,'src/index.mjs'),Object.keys(implementations).map(r=>`export * from './pipeline/${r}.mjs';`).join('\n')+'\n');
const result=spawnSync(process.execPath,['--test','test/ingest.test.mjs','test/delivery.test.mjs','test/view.test.mjs','test/integration.test.mjs'],{cwd:directory,encoding:'utf8'});
writeFileSync(join(import.meta.dirname,'offline-reference.json'),JSON.stringify({time:new Date().toISOString(),...created,status:result.status,stdout:result.stdout,stderr:result.stderr,paidInference:false},null,2));
console.log(result.stdout);if(result.status!==0)console.error(result.stderr);process.exitCode=result.status;
