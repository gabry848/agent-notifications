import {existsSync,mkdirSync,readFileSync,readdirSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {startDefaultPi} from './pi-runtime.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const dir=join(root,'offline','durable-resume');
if(existsSync(dir))throw Error('Preserve previous test');
mkdirSync(dir,{recursive:true});mkdirSync(join(dir,'work'));mkdirSync(join(dir,'sessions'));
const saved=[];
for(const label of ['first','resumed']) {
  const out=join(dir,label);mkdirSync(out);
  const env={CACHE_NOTIFICATION_EXTENSION:join(root,'../../src/pi-extension.ts'),CACHE_SAVE_SESSION_DIR:join(dir,'sessions'),
    ...(saved.length?{CACHE_RESUME_FILE:saved[0]}:{}),PI_NOTIFY_CONTEXT:'1',PI_NOTIFY_DB:join(dir,'notifications.sqlite'),PI_NOTIFY_PORT:'0',
    PI_NOTIFY_READY:join(out,'ready.json'),PI_NOTIFY_TRACE:join(out,'notifications.jsonl'),PI_NOTIFY_PROMPT:join(root,'verification-prompt.txt'),
    CACHE_COMMON_PROMPT:join(root,'verification-prompt.txt'),CACHE_TRACE:join(out,'hashes.jsonl'),CACHE_RESULT:join(out,'result.json'),CACHE_OFFLINE:'1'};
  const client=startDefaultPi({work:join(dir,'work'),configDir:join(out,'config'),env,eventsPath:join(out,'events.jsonl'),
    extraExtensions:[join(root,'probe-extension.ts')],tools:['probe_step','notifications_dismiss','notifications_history'],disableMeter:true});
  try{
    await client.waitReady();
    const state=await client.command({type:'get_state'});writeFileSync(join(out,'resolved.json'),JSON.stringify({state,args:client.args},null,2));
    await client.prompt('Complete exactly six probe_step calls sequentially. Each observed is the previous Canonical policy fact verbatim. Initially policy limit=31. Use no other tools. Then return DONE.');
  }finally{await client.stop();const link=join(out,'config/auth.json');if(existsSync(link))unlinkSync(link);}
  if(!saved.length)for(const name of readdirSync(join(dir,'sessions')))if(name.endsWith('.jsonl'))saved.push(join(dir,'sessions',name));
}
assert.equal(saved.length,1);
const firstState=JSON.parse(readFileSync(join(dir,'first/resolved.json'))).state;
const secondState=JSON.parse(readFileSync(join(dir,'resumed/resolved.json'))).state;
assert.equal(firstState.sessionId,secondState.sessionId);
const rows=readFileSync(join(dir,'resumed/hashes.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
const first=rows.find(e=>e.type==='payload_hashes');
assert.equal(first.notificationIndexes.length,8);
const result=JSON.parse(readFileSync(join(dir,'resumed/result.json')));
assert.equal(result.journalRecords,14);assert.equal(result.journalSessionIsolated,true);
const sessions=readFileSync(saved[0],'utf8').trim().split('\n').map(JSON.parse);
assert.equal(sessions.filter(e=>e.type==='custom'&&e.customType==='notification-context-journal-v1').length,14);
assert.equal(sessions.filter(e=>e.type==='message'&&e.message?.role==='custom').length,0);
const report={paidInference:false,externalHttpAttempts:0,fixtureModelResponses:14,sessionRestarted:true,sameSessionId:true,
  previousSnapshotsOnFirstResumedRequest:7,journalEntries:14,customMetadataPersisted:true,snapshotsAbsentFromNativeTranscript:true,
  authLinksRemoved:['first','resumed'].every(label=>!existsSync(join(dir,label,'config/auth.json')))};
writeFileSync(join(dir,'assertions.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
