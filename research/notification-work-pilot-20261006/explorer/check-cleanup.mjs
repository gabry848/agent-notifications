import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
const run=resolve(process.argv[2]);
const ready=JSON.parse(readFileSync(join(run,'ready.json'),'utf8'));
const events=readFileSync(join(run,'rpc.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const urls=new Set([ready.url]);
for(const row of events){const m=row.event?.message;
  if(row.event?.type!=='message_end'||m?.role!=='toolResult')continue;
  for(const block of m.content??[])if(block.type==='text')for(const match of block.text.matchAll(/http:\/\/127\.0\.0\.1:\d+/g))urls.add(match[0]);
}
const checks=[];
for(const url of urls){
  try{const response=await fetch(url,{signal:AbortSignal.timeout(1000)});checks.push({url,closed:false,status:response.status});}
  catch(e){checks.push({url,closed:e.cause?.code==='ECONNREFUSED',code:e.cause?.code??e.name});}
}
const result={time:new Date().toISOString(),ownedLoopbackEndpoints:checks,
  authLinkRemoved:!existsSync(join(run,'config','auth.json')),allCheckedEndpointsClosed:checks.every(x=>x.closed),
  limitation:'Verifies owned notification/demo endpoint lifecycle; not a whole-machine process inventory.'};
writeFileSync(join(run,'cleanup.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
