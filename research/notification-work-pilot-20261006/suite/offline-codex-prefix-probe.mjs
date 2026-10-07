// Offline serialization check: captures onPayload and aborts BEFORE any HTTP.
// Synthetic context, not a model execution or a reconstruction of measured traces.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { installedRuntime } from './installed-runtime.mjs';
const runtime=installedRuntime();
const provider=await import(pathToFileURL(runtime.providerImplementation).href);
const model=JSON.parse(readFileSync(new URL('./traces/group-PA/ingest/resolved.json',import.meta.url))).state.model;
const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const fakeCredential=enc({alg:'none'})+'.'+enc({'https://api.openai.com/auth':{chatgpt_account_id:'offline-fixture-only'}})+'.offline';
let fetchAttempts=0;const realFetch=globalThis.fetch;
globalThis.fetch=async()=>{fetchAttempts++;throw Error('Offline probe prohibits all HTTP');};
const contexts=[
  [{role:'user',content:[{type:'text',text:'Stable task input.'}],timestamp:1},{role:'user',content:[{type:'text',text:'Stable conversation history.'}],timestamp:2},{role:'user',content:[{type:'text',text:'<runtime_notifications>event revision1</runtime_notifications>'}],timestamp:3}],
  [{role:'user',content:[{type:'text',text:'Stable task input.'}],timestamp:1},{role:'user',content:[{type:'text',text:'Stable conversation history.'}],timestamp:2},{role:'user',content:[{type:'text',text:'New useful work result.'}],timestamp:4},{role:'user',content:[{type:'text',text:'<runtime_notifications>event revision2</runtime_notifications>'}],timestamp:5}],
];
const payloads=[];
try{
  for(const messages of contexts){let captured;
    const stream=provider.stream(model,{systemPrompt:'Stable system instruction.',messages,tools:[]},{apiKey:fakeCredential,sessionId:'offline-prefix-fixture',transport:'sse',onPayload:body=>{captured=body;throw Error('Offline capture complete; no request sent');}});
    await stream.result();if(!captured)throw Error('Provider body not captured');payloads.push(captured);
  }
}finally{globalThis.fetch=realFetch;}
const text=item=>(item.content??[]).map(v=>v.text??'').join('');
const prefixes=payloads.map(p=>p.input.map(text));
let sharedItems=0;while(sharedItems<Math.min(prefixes[0].length,prefixes[1].length)&&JSON.stringify(payloads[0].input[sharedItems])===JSON.stringify(payloads[1].input[sharedItems]))sharedItems++;
const result={paidInference:false,piSessions:0,httpAttempts:fetchAttempts,providerImplementation:runtime.providerImplementation,
  notificationIndexes:prefixes.map(p=>p.findIndex(s=>s.includes('<runtime_notifications>'))),inputLengths:prefixes.map(p=>p.length),equalLeadingInputItems:sharedItems,
  promptCacheKeys:payloads.map(p=>p.prompt_cache_key),notificationsAreLastInputItem:prefixes.every(p=>p.at(-1)?.includes('<runtime_notifications>')),
  scope:'Synthetic native Codex provider serialization only. No token cache-hit inference; does not reconstruct measured Pi contexts or explain their observed cache fraction.'};
writeFileSync(new URL('./offline-codex-prefix-probe.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
if(fetchAttempts!==0)throw Error('HTTP was attempted despite offline abort');
