import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pause, log, redact, json } from './common.mjs';

export function startPi({work,config,env,eventsPath,stderrPath,root,model='gpt-6.1-sol'}) {
  const allowed=['start_job','get_job','await_jobs','pause','read_files','write_file','verify_files','submit_plan'];
  if(env.BENCH_MODE==='N'&&env.PI_NOTIFY_CONTEXT!=='0')allowed.push('notifications_dismiss','notifications_history');
  const child=spawn(process.env.PI_BINARY??'pi',[
    '--mode','rpc','--no-session','--offline','--no-extensions','--no-skills','--no-prompt-templates',
    '--no-context-files','--no-themes','--no-approve','--provider','openai','--model',model,'--thinking','medium',
    ...(env.BENCH_SESSION_ID?['--session-id',env.BENCH_SESSION_ID]:[]),
    '--tools',allowed.join(','),'-e',root+'/src/pi-extension.ts','-e',root+'/benchmark/extension.ts',
  ],{cwd:work,stdio:['pipe','pipe','pipe'],env:{...process.env,...env,PI_CODING_AGENT_DIR:config,PI_TELEMETRY:'0',PI_OFFLINE:'1'}});
  let buffer='',exitCode,spawnError,serial=0;
  const events=[],responses=new Map();
  const clean=value=>{
    if(Array.isArray(value))return value.filter(v=>v?.type!=='thinking').map(clean);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['thinking','thinkingSignature','textSignature'].includes(k)).map(([k,v])=>[k,clean(v)]));
    return typeof value==='string'?redact(value):value;
  };
  child.once('error',e=>{spawnError=e;});child.once('exit',code=>{exitCode=code??-1;});
  child.stderr.on('data',chunk=>log(stderrPath,'stderr',{text:redact(chunk)}));
  child.stdout.on('data',chunk=>{
    buffer+=chunk;
    let i;
    while((i=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,i);buffer=buffer.slice(i+1);
      try{const event=clean(JSON.parse(line));if(event.type==='message_update')continue;
        events.push(event);log(eventsPath,'rpc_event',{event});if(event.type==='response')responses.set(event.id,event);
      }catch{if(line.trim())log(stderrPath,'stdout_non_rpc',{text:redact(line)});}
    }
  });
  const wait=async(check,label,timeout=Number(env.BENCH_TIMEOUT??600000))=>{
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){
      const value=check();if(value)return value;
      if(spawnError)throw spawnError;
      if(exitCode!==undefined)throw new Error(`Pi exited ${exitCode} waiting for ${label}`);
      await pause(25);
    }throw new Error(`Timeout: ${label}`);
  };
  const command=async body=>{
    const id=`rpc-${++serial}`;child.stdin.write(JSON.stringify({id,...body})+'\n');
    const response=await wait(()=>responses.get(id),body.type);
    if(!response.success)throw new Error(response.error??`${body.type} failed`);
    return response.data;
  };
  const prompt=async message=>{
    const offset=events.length;
    await command({type:'prompt',message});
    await wait(()=>events.slice(offset).find(e=>e.type==='agent_settled'),'agent settled');
    const failed=events.slice(offset).find(e=>e.type==='message_end'&&e.message?.role==='assistant'&&e.message?.stopReason==='error');
    if(failed)throw new Error(failed.message.errorMessage??'Provider error');
  };
  const stop=async()=>{
    if(exitCode===undefined){child.stdin.end();const deadline=Date.now()+4000;while(exitCode===undefined&&Date.now()<deadline)await pause(25);}
    if(exitCode===undefined){child.kill('SIGTERM');await pause(300);}
    if(exitCode===undefined)child.kill('SIGKILL');
  };
  const ready=()=>json(env.PI_NOTIFY_READY);
  return {child,events,command,prompt,wait,stop,ready,get exitCode(){return exitCode;},
    waitReady:()=>wait(()=>existsSync(env.PI_NOTIFY_READY)&&events.some(e=>e.type==='response')?true:existsSync(env.PI_NOTIFY_READY),'notification endpoint',20000)};
}
