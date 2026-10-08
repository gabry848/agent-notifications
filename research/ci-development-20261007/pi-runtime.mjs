import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, symlinkSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ACCOUNTING={mode:'observational',monetaryCaps:false,requestCaps:false};
const root = fileURLToPath(new URL('.',import.meta.url));
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
const sanitize = value => {
  if (Array.isArray(value)) return value.filter(x=>x?.type!=='thinking').map(sanitize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key])=>!['thinking','thinkingSignature','textSignature'].includes(key))
    .map(([key,v])=>[key,/token|password|secret|apiKey/i.test(key)&&typeof v==='string'?'[redacted]':sanitize(v)]));
  return value;
};
export function prepareDefaultConfig(configDir) {
  mkdirSync(configDir,{recursive:true});
  const userDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(),'.pi','agent');
  const global = JSON.parse(readFileSync(join(userDir,'settings.json'),'utf8'));
  const settings = {defaultModel:global.defaultModel,defaultProvider:global.defaultProvider,
    defaultThinkingLevel:global.defaultThinkingLevel,compaction:global.compaction,
    transport:'sse',retry:{enabled:false,maxRetries:0},packages:[],extensions:[]};
  if (!settings.defaultModel || !settings.defaultProvider) throw new Error('Explicit Pi user default unavailable');
  writeFileSync(join(configDir,'settings.json'),JSON.stringify(settings,null,2));
  const auth=join(userDir,'auth.json'), link=join(configDir,'auth.json');
  if (existsSync(auth) && !existsSync(link)) symlinkSync(auth,link);
  return {settings,accounting:ACCOUNTING,authReused:existsSync(auth),
    deviations:['isolated config','transport=sse equally across modes','agent retries disabled; provider-internal retries still guarded',
      'installed extensions/skills/context files disabled; explicit extensions and native file tools only']};
}
export function startDefaultPi({work,configDir,env={},eventsPath,extraExtensions=[],tools,
  timeoutMs=1800000,disableMeter=true}) {
  const config=prepareDefaultConfig(configDir);
  const args=['--mode','rpc',...(env.CACHE_SAVE_SESSION_DIR?['--session-dir',env.CACHE_SAVE_SESSION_DIR]:['--no-session']),
    ...(env.CACHE_RESUME_FILE?['--session',env.CACHE_RESUME_FILE]:[]),'--offline','--no-extensions','--no-skills',
    '--no-prompt-templates','--no-context-files','--no-themes','--no-approve',
    ...(env.PILOT_SESSION_ID?['--session-id',env.PILOT_SESSION_ID]:[]),
    ...(tools?['--tools',tools.join(',')]:[]),
    '-e',env.CACHE_NOTIFICATION_EXTENSION??root+'../../src/pi-extension.ts',
    ...(!disableMeter?['-e',root+'meter-extension.ts']:[]),
    ...extraExtensions.flatMap(path=>['-e',path])];
  // No --provider, --model or --thinking override. The copied actual defaults resolve normally.
  const child=spawn(process.env.PI_BINARY??'pi',args,{cwd:work,stdio:['pipe','pipe','pipe'],
    env:{...process.env,...env,PI_CODING_AGENT_DIR:configDir,PI_TELEMETRY:'0',PI_OFFLINE:'1',
      PI_NOTIFY_DISMISS:env.PI_NOTIFY_DISMISS??'batch',PI_NOTIFY_POSITION:'tail',PI_NOTIFY_LAB:'0'}});
  const events=[],responses=new Map(); let buffer='',exitCode,spawnError,serial=0,stderr='';
  const log=(type,data)=>{if(eventsPath)appendFileSync(eventsPath,JSON.stringify({time:new Date().toISOString(),
    monoMs:Number(process.hrtime.bigint())/1e6,type,...sanitize(data)})+'\n');};
  child.on('error',e=>{spawnError=e;}); child.on('exit',code=>{exitCode=code??-1;});
  child.stderr.on('data',chunk=>{stderr+=chunk;log('stderr',{text:String(chunk)});});
  child.stdout.on('data',chunk=>{
    buffer+=chunk; let index;
    while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
      try{const event=sanitize(JSON.parse(line));if(event.type==='message_update')continue;
        events.push(event);log('rpc_event',{event});if(event.type==='response')responses.set(event.id,event);
      }catch{if(line.trim())log('stdout_non_rpc',{text:line});}}
  });
  const wait=async(check,label,ms=timeoutMs)=>{
    const deadline=Date.now()+ms;
    while(Date.now()<deadline){const result=check();if(result)return result;
      if(spawnError)throw spawnError;if(exitCode!==undefined)throw new Error(`Pi exited ${exitCode} waiting ${label}; ${stderr}`);
      await pause(20);}throw new Error('Timeout: '+label);
  };
  const command=async body=>{const id='rpc-'+(++serial);child.stdin.write(JSON.stringify({id,...body})+'\n');
    const response=await wait(()=>responses.get(id),body.type,30000);
    if(!response.success)throw new Error(response.error??'RPC failure');return response.data;};
  const prompt=async message=>{const offset=events.length;await command({type:'prompt',message});
    await wait(()=>events.slice(offset).find(e=>e.type==='agent_settled'),'settled');
    const failed=events.slice(offset).find(e=>e.type==='message_end'&&e.message?.role==='assistant'&&e.message?.stopReason==='error');
    if(failed)throw new Error(failed.message.errorMessage??'Provider error');};
  const stop=async()=>{if(exitCode===undefined){child.stdin.end();const until=Date.now()+4000;
    while(exitCode===undefined&&Date.now()<until)await pause(20);}
    if(exitCode===undefined){child.kill('SIGTERM');await pause(200);}if(exitCode===undefined)child.kill('SIGKILL');};
  return {child,args,config,events,command,prompt,wait,stop,
    waitReady:()=>wait(()=>env.PI_NOTIFY_READY&&existsSync(env.PI_NOTIFY_READY),'notify ready',20000),
    ready:()=>JSON.parse(readFileSync(env.PI_NOTIFY_READY,'utf8')),get exitCode(){return exitCode;}};
}
