import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {join} from 'node:path';
const timeout=(promise,ms=15000)=>Promise.race([promise,new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('client timeout')),ms);t.unref();})]);
export const htmlText=html=>html.replace(/<[^>]*>/g,'').replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|#39);/gi,(entity,key)=>{const names={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(key[0]!=='#')return names[key.toLowerCase()]??entity;const value=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);return value>=0&&value<=0x10ffff?String.fromCodePoint(value):entity;});
export async function mcpClient(work,db) {
  const p=spawn(process.execPath,[join(work,'src/mcp.mjs'),'--db',db],{cwd:work,stdio:['pipe','pipe','pipe']});
  let seq=0,stderr='';const pending=new Map(),lines=[];
  p.stderr.on('data',x=>stderr+=x);
  createInterface({input:p.stdout}).on('line',line=>{lines.push(line);try{const msg=JSON.parse(line);if(pending.has(msg.id)){pending.get(msg.id).resolve(msg);pending.delete(msg.id);}}catch{}});
  p.on('exit',code=>{for(const waiter of pending.values())waiter.reject(new Error(`MCP exited ${code}: ${stderr}`));pending.clear();});
  const request=(method,params={})=>timeout(new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});p.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');}));
  const notify=(method,params={})=>p.stdin.write(JSON.stringify({jsonrpc:'2.0',method,params})+'\n');
  const call=async(name,args={})=>{
    const result=await request('tools/call',{name,arguments:args});
    if(result.error||result.result?.isError)throw new Error(JSON.stringify(result));
    return JSON.parse(result.result.content.find(x=>x.type==='text').text);
  };
  const close=async()=>{p.stdin.end();await timeout(new Promise(resolve=>{if(p.exitCode!==null)return resolve();p.once('exit',resolve);}),3000).catch(()=>p.kill());};
  const initialize=()=>request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'external-notes-ci',version:'1.0'}});
  return {p,request,notify,call,close,initialize,lines};
}
export async function webClient(work,db) {
  const p=spawn(process.execPath,[join(work,'src/web.mjs'),'--db',db,'--port','0'],{cwd:work,stdio:['ignore','pipe','pipe']});
  let stderr='';p.stderr.on('data',x=>stderr+=x);
  const port=await timeout(new Promise((resolve,reject)=>{
    createInterface({input:p.stdout}).on('line',line=>{try{const parsed=JSON.parse(line);if(parsed.port)resolve(parsed.port);}catch{}});
    p.once('exit',code=>reject(new Error(`Web exited ${code}: ${stderr}`)));
  }));
  const url=`http://127.0.0.1:${port}`;
  const request=async(path,options={})=>{const res=await fetch(url+path,{...options,signal:AbortSignal.timeout(12000)});const text=await res.text();return {status:res.status,headers:Object.fromEntries(res.headers),text,json:()=>JSON.parse(text)};};
  const json=(path,method,body)=>request(path,{method,headers:{'content-type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const form=(path,fields)=>request(path,{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields)});
  const close=async()=>{p.kill('SIGTERM');await timeout(new Promise(resolve=>{if(p.exitCode!==null)return resolve();p.once('exit',resolve);}),3000).catch(()=>p.kill('SIGKILL'));};
  return {p,url,request,json,form,close};
}
