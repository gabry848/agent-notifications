import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const root=fileURLToPath(new URL('.',import.meta.url));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function startBoard(directory) {
  mkdirSync(directory,{recursive:true});const readyPath=join(directory,'ready.json');
  // A fresh directory per group avoids accidentally reading a stale endpoint.
  if(existsSync(readyPath))throw new Error('Board directory already initialized; choose fresh group directory');
  const child=spawn('python3',[root+'coordinator_server.py','--database',join(directory,'board.sqlite'),
    '--ready',readyPath,'--trace',join(directory,'board.jsonl')],{stdio:['ignore','ignore','pipe']});
  let exitCode,spawnError;child.on('error',e=>{spawnError=e;});child.on('exit',c=>{exitCode=c??-1;});
  child.stderr.on('data',chunk=>appendFileSync(join(directory,'stderr.log'),String(chunk)));
  const deadline=Date.now()+10000;
  while(!existsSync(readyPath)){
    if(spawnError)throw spawnError;if(exitCode!==undefined)throw new Error('Board exited '+exitCode);
    if(Date.now()>=deadline){child.kill('SIGTERM');throw new Error('Board startup timed out');}await pause(20);
  }
  const ready=JSON.parse(readFileSync(readyPath));
  const call=async(name,args={})=>{
    const headers={'Content-Type':'application/json'};
    // Producer key remains outside Pi's env/config and is never logged or returned.
    if(name==='publish_update')headers['X-Coordinator-Producer-Token']=readFileSync(ready.producerKeyFile,'utf8').trim();
    const response=await fetch(ready.url+'/rpc',{method:'POST',headers,signal:AbortSignal.timeout(70000),
      body:JSON.stringify({jsonrpc:'2.0',id:randomUUID(),method:'tools/call',params:{name,arguments:args}})});
    if(!response.ok)throw new Error('Coordinator HTTP '+response.status);
    const rpc=await response.json();if(rpc.error)throw new Error(rpc.error.message);
    const result=JSON.parse(rpc.result.content.find(c=>c.type==='text').text);
    if(rpc.result.isError)throw new Error(result.error);return result;
  };
  const stop=async()=>{if(exitCode===undefined)child.kill('SIGTERM');const deadline=Date.now()+5000;
    while(exitCode===undefined&&Date.now()<deadline)await pause(20);
    if(exitCode===undefined)child.kill('SIGKILL');return {exitCode:exitCode??null};};
  return {child,ready,call,stop};
}
