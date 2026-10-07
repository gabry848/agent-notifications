import { createServer } from 'node:http';
import { createHmac,timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { json,save,log,stamp,pause } from '../common.mjs';

export async function webhook({secret,repoId,controlDir,tracePath}){
  const registry=new Map(),seen=new Set();
  const server=createServer(async(req,res)=>{
    const reply=(status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
    if(req.method!=='POST'||req.url!=='/webhook'){req.resume();return reply(404,{error:'Not found'});}
    try{
      const chunks=[];let length=0;
      for await(const chunk of req){length+=chunk.length;if(length>1000000)return reply(413,{error:'Body too large'});chunks.push(chunk);}
      const body=Buffer.concat(chunks),signature=Buffer.from(String(req.headers['x-hub-signature-256']??''));
      const expected=Buffer.from('sha256='+createHmac('sha256',secret).update(body).digest('hex'));
      if(signature.length!==expected.length||!timingSafeEqual(signature,expected))return reply(401,{error:'Invalid signature'});
      const payload=JSON.parse(body.toString());
      if(payload.repository?.id!==repoId)return reply(403,{error:'Unexpected repository'});
      const delivery=String(req.headers['x-github-delivery']??'');
      log(tracePath,'github_webhook',{delivery,event:req.headers['x-github-event'],action:payload.action,hookId:payload.hook_id??payload.hook?.id});
      if(seen.has(delivery))return reply(200,{duplicate:true});seen.add(delivery);
      if(req.headers['x-github-event']==='ping')return reply(200,{pong:true});
      const run=payload.workflow_run;
      if(req.headers['x-github-event']!=='workflow_run'||!run)return reply(200,{ignored:true});
      const experimentId=String(run.display_title??run.name??'').replace(/^bench-/,'');
      const entry=registry.get(experimentId);if(!entry)return reply(200,{ignored:true});
      entry.destination??=json(entry.readyPath);
      if(entry.completed)return reply(200,{ignored:true,terminal:true});
      const record={runId:run.id,url:run.html_url,status:run.status,conclusion:run.conclusion,createdAt:run.created_at,startedAt:run.run_started_at,updatedAt:run.updated_at,received:stamp()};
      if(run.status==='completed'&&!entry.completed){
        entry.completed=true;
        if(entry.mode==='N'){
          const notification={sessionId:entry.destination.sessionId,source:'GitHub Actions',message:JSON.stringify({jobId:entry.jobId,revision:1,status:run.conclusion==='success'?'succeeded':'failed',result:{maxBatch:0,conclusion:run.conclusion,runId:run.id,region:'eu-west-1',release:'v1.4'}})};
          for(let attempt=1;attempt<=3;attempt++){
            log(entry.mcpPath,'notify_attempt',{jobId:entry.jobId,attempt});
            try{
              const response=await fetch(entry.destination.url+'/notify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(notification),signal:AbortSignal.timeout(5000)});
              if(!response.ok)throw new Error(`Notify HTTP ${response.status}`);
              log(entry.mcpPath,'notify_accepted',{jobId:entry.jobId,notification:await response.json()});record.notificationDelivered=true;break;
            }catch(e){log(entry.mcpPath,'notify_error',{jobId:entry.jobId,attempt,error:e.message});if(attempt<3)await pause(200*2**attempt);}
          }
        }
      }
      // Release the await tool only after local notification ingress completes.
      // A delayed older webhook must never replace the terminal state.
      if(!entry.completed||record.status==='completed')save(join(controlDir,experimentId+'.json'),record);
      return reply(200,{accepted:true});
    }catch(e){log(tracePath,'webhook_error',{error:e.message});return reply(400,{error:'Invalid webhook'});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}`,register:(id,value)=>registry.set(id,value),records:registry,
    close:()=>new Promise((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeIdleConnections();})};
}
