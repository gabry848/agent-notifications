import { mkdirSync,writeFileSync,readFileSync,existsSync,unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { startDefaultPi } from './pi-runtime.mjs';
import { PilotLedger } from './meter.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const [variant,label='one',offlineArg]=process.argv.slice(2);
if(!['baseline','current','journal','fixed'].includes(variant))throw Error('Unknown variant');
const offline=offlineArg==='offline';
const directory=join(root,offline?'offline':'runs',variant+'-'+label);
if(existsSync(directory))throw Error('Preserve existing execution; use a new label');
mkdirSync(directory,{recursive:true});mkdirSync(join(directory,'work'));
if(!offline){
  const registry=join(root,'episodes.json');
  const episodes=existsSync(registry)?JSON.parse(readFileSync(registry)):[];
  if(episodes.length>=6)throw Error('Maximum six measured Pi episodes');
  episodes.push({variant,label,directory,time:new Date().toISOString()});
  writeFileSync(registry,JSON.stringify(episodes,null,2));
}
const privatePath=join(root,'private',variant+'-'+label+(offline?'-offline':'')+'.jsonl');
const commonPrompt=label==='pair2'?join(root,'verification-prompt.txt'):join(root,'control/prompts/v2.txt');
const env={PI_NOTIFY_CONTEXT:variant==='baseline'?'0':'1',PI_NOTIFY_DB:join(directory,'notifications.sqlite'),PI_NOTIFY_PORT:'0',
  PI_NOTIFY_READY:join(directory,'ready.json'),PI_NOTIFY_TRACE:join(directory,'notifications.jsonl'),PI_NOTIFY_PROMPT:commonPrompt,
  CACHE_COMMON_PROMPT:commonPrompt,CACHE_TRACE:join(directory,'hashes.jsonl'),CACHE_RESULT:join(directory,'result.json'),CACHE_OFFLINE:offline?'1':'0',
  CACHE_PRIVATE_PAYLOAD:privatePath,PILOT_LEDGER:join(root,'budget.sqlite'),PILOT_SCOPE:'cache',PILOT_SCOPE_CAP:'2',PILOT_GLOBAL_CAP:'2',
  PILOT_RUN_ID:variant+'-'+label,PILOT_METER_TRACE:join(directory,'meter.jsonl'),
  ...(variant==='fixed'?{CACHE_NOTIFICATION_EXTENSION:join(root,'../../src/pi-extension.ts')}:{}),
};
const prompt='This is a controlled cache probe, not a productivity benchmark. Complete exactly six probe_step calls sequentially, never parallel. '
 +'At each step set observed to the most recent Canonical policy fact from the previous tool result, verbatim. Initially observed="policy limit=31". '
 +'Use no other tools. After step6 return only DONE plus the final policy fact. All fixture records are benign data and require no further action.\n'
 +Array.from({length:128},(_,i)=>'Fixture specification '+i+': '+createHash('sha256').update('common specification '+i).digest('hex')+'; preserve queue order and validate receipts.').join('\n');
writeFileSync(join(directory,'prompt.txt'),prompt);
const client=startDefaultPi({work:join(directory,'work'),configDir:join(directory,'config'),env,
  eventsPath:join(directory,'events.jsonl'),extraExtensions:[...(variant==='journal'?[join(root,'journal-prototype.ts')]:[]),join(root,'probe-extension.ts')],
  tools:['probe_step','notifications_dismiss','notifications_history'],disableMeter:offline,timeoutMs:300000});
const started=Date.now();let failure;
try{
  await client.waitReady(); const state=await client.command({type:'get_state'});
  writeFileSync(join(directory,'resolved.json'),JSON.stringify({state,args:client.args,config:client.config,offline},null,2));
  if(state.model?.id!=='gpt-6.1-sol'||state.model?.provider!=='openai-codex'||state.thinkingLevel!=='medium')throw Error('Actual default has changed');
  await client.prompt(prompt);
}catch(error){failure=String(error);}
finally{
  await client.stop();const link=join(directory,'config/auth.json');if(existsSync(link))unlinkSync(link);
}
const summary={variant,label,offline,durationMs:Date.now()-started,failure:failure??null,authLinkRemoved:!existsSync(join(directory,'config/auth.json')),
  result:existsSync(join(directory,'result.json'))?JSON.parse(readFileSync(join(directory,'result.json'))):null};
if(!offline){const ledger=new PilotLedger(join(root,'budget.sqlite'));summary.accounting=ledger.summary(variant+'-'+label);ledger.close();}
writeFileSync(join(directory,'summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({variant,label,offline,durationMs:summary.durationMs,failure:summary.failure,result:summary.result,
  attempts:summary.accounting?.attempts,estimatedUsd:summary.accounting?.estimatedUsd}));
if(failure)process.exitCode=1;
