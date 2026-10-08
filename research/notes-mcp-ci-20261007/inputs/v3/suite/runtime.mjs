import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,symlinkSync,appendFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const sanitize=value=>Array.isArray(value)?value.filter(x=>x?.type!=='thinking').map(sanitize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>!['thinking','thinkingSignature','textSignature'].includes(k)).map(([k,v])=>[k,/token|password|secret|apiKey/i.test(k)&&typeof v==='string'?'[redacted]':sanitize(v)])):value;
export function startPi({work,config,extensions,env,eventsPath,timeoutMs=1800000}){
  mkdirSync(config,{recursive:true});const defaults=JSON.parse(readFileSync(join(homedir(),'.pi/agent/settings.json'),'utf8'));
  const settings={defaultModel:defaults.defaultModel,defaultProvider:defaults.defaultProvider,defaultThinkingLevel:defaults.defaultThinkingLevel,compaction:defaults.compaction,transport:'sse',retry:{enabled:false,maxRetries:0},packages:[],extensions:[]};
  if(settings.defaultModel!=='gpt-6.1-sol'||settings.defaultProvider!=='openai-codex'||settings.defaultThinkingLevel!=='medium')throw new Error('Unexpected actual default');
  writeFileSync(join(config,'settings.json'),JSON.stringify(settings,null,2));symlinkSync(join(homedir(),'.pi/agent/auth.json'),join(config,'auth.json'));
  const args=['--mode','rpc','--session-dir',join(config,'sessions'),'--offline','--no-extensions','--no-skills','--no-prompt-templates','--no-context-files','--no-themes','--no-approve',...extensions.flatMap(e=>['-e',e])];
  const child=spawn('pi',args,{cwd:work,env:{...process.env,...env,PI_CODING_AGENT_DIR:config,PI_TELEMETRY:'0',PI_OFFLINE:'1'},stdio:['pipe','pipe','pipe']});
  const events=[],responses=new Map();let buffer='',serial=0,exit;
  const log=(type,data)=>appendFileSync(eventsPath,JSON.stringify({time:new Date().toISOString(),monoMs:Number(process.hrtime.bigint())/1e6,type,...sanitize(data)})+'\n');
  child.on('exit',code=>exit=code??-1);child.on('error',e=>log('spawn_error',{error:String(e)}));child.stderr.on('data',x=>log('stderr',{text:String(x)}));
  child.stdout.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const event=sanitize(JSON.parse(line));if(event.type==='message_update')continue;events.push(event);log('rpc_event',{event});if(event.type==='response')responses.set(event.id,event);}catch{if(line.trim())log('stdout_non_rpc',{text:line});}}});
  const wait=async(fn,label,ms=timeoutMs)=>{const end=Date.now()+ms;while(Date.now()<end){const value=fn();if(value)return value;if(exit!==undefined)throw new Error(`Pi exited ${exit}: ${label}`);await sleep(25);}throw new Error('Timeout '+label);};
  const command=async body=>{const id='rpc-'+(++serial);child.stdin.write(JSON.stringify({id,...body})+'\n');const result=await wait(()=>responses.get(id),'command '+body.type,30000);if(!result.success)throw new Error(result.error);return result.data;};
  const prompt=async message=>{const offset=events.length;await command({type:'prompt',message});await wait(()=>events.slice(offset).some(e=>e.type==='agent_settled'),'agent settled');const error=events.slice(offset).find(e=>e.type==='message_end'&&e.message?.stopReason==='error');if(error)throw new Error(error.message.errorMessage);};
  const stop=async()=>{child.stdin.end();await Promise.race([new Promise(r=>child.once('exit',r)),sleep(2500)]);if(exit===undefined)child.kill('SIGTERM');await sleep(200);if(exit===undefined)child.kill('SIGKILL');};
  return {child,settings,args,events,wait,command,prompt,stop};
}
