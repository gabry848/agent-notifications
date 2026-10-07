import { random } from './common.mjs';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

export function notificationState(path,sessionId){
  if(!existsSync(path))return null;
  const db=new DatabaseSync(path,{readOnly:true});
  try{
    const row=db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(dismissed_at IS NULL),0) AS active FROM notifications WHERE session_id=?').get(sessionId);
    return {...row,dismissed:row.total-row.active};
  }finally{db.close();}
}

export function assess({spec,mode,result,mcp,runtime,notifications,events,filesPassed,error}) {
  const failures=[];
  if(error)failures.push(error);
  for(const [key,value]of Object.entries(spec.expected))if(result?.[key]!==value)failures.push(`${key}: expected ${value}, got ${result?.[key]}`);
  const expectedIds=spec.jobs.map(j=>j.id).sort();
  if(JSON.stringify([...(result?.jobIds??[])].sort())!==JSON.stringify(expectedIds))failures.push('Final job IDs differ');
  if(spec.independent&&!filesPassed)failures.push('Fixture file tests failed');
  const submitted=runtime.filter(e=>e.type==='plan_submitted');
  if(submitted.length!==1)failures.push(`Expected one submission, observed ${submitted.length}`);
  if(spec.independent&&submitted[0]&&!runtime.some(e=>e.type==='files_verified'&&e.passed&&e.monoMs<submitted[0].monoMs))failures.push('Agent did not verify fixture files before submission');
  const finished=mcp.filter(e=>e.type==='job_finished');
  if(finished.length!==spec.jobs.length)failures.push('Not all jobs finished');
  if(spec.github)for(const job of spec.jobs){
    const observed=finished.find(e=>e.jobId===job.id)?.result?.conclusion;
    if(observed!==job.outcome)failures.push(`GitHub conclusion: expected ${job.outcome}, got ${observed}`);
  }
  if(submitted[0]&&finished.some(e=>e.monoMs>submitted[0].monoMs))failures.push('Plan submitted before final results');
  const dispatch=mcp.filter(e=>e.type==='tools_call');
  if(spec.unsolicited&&dispatch.length)failures.push('Unsolicited test called MCP tools');
  if(mode==='N'&&!spec.unsolicited&&dispatch.some(e=>e.name==='get_job'))failures.push('Notification mode polled job status');
  if(mode==='W'&&dispatch.some(e=>e.name==='get_job'))failures.push('Blocking mode polled');
  if(['P10','PA'].includes(mode)&&dispatch.some(e=>e.name==='await_jobs'))failures.push('Polling mode used blocking fallback');
  const checks=mcp.filter(e=>e.type==='status_check');let pending=0;
  for(let i=0;i<checks.length-1;i++)if(checks[i].pending){
    const needed=mode==='P10'?10000:mode==='PA'?[2000,4000,8000,16000,30000][Math.min(pending,4)]:0;
    if(checks[i+1].monoMs-checks[i].monoMs+50<needed)failures.push('Polling cadence too short');pending++;
  }
  const deliveryFailures=[],injectionFailures=[];
  if(mode==='N')for(const job of spec.jobs)if(!mcp.some(e=>e.type==='notify_accepted'&&e.jobId===job.id)){
    const reason=mcp.filter(e=>e.type==='notify_error'&&e.jobId===job.id).at(-1)?.error??'No accepted notification';
    deliveryFailures.push({jobId:job.id,reason});failures.push(`Notification delivery failed for ${job.id}: ${reason}`);
  }
  if(mode==='N')for(const accepted of mcp.filter(e=>e.type==='notify_accepted')){
    const arrival=notifications.find(e=>e.type==='notification_received'&&e.notification.id===accepted.notification.id);
    const next=notifications.find(e=>e.type==='context_snapshot'&&e.call>arrival?.lastContextCall);
    if(next&&!next.active.some(n=>n.id===accepted.notification.id&&n.turnAge===0))injectionFailures.push(accepted.notification.id);
    if(!arrival)injectionFailures.push(accepted.notification.id);
  }
  if(injectionFailures.length)failures.push('Notification first-exposure invariant failed');
  const payloads=events.filter(e=>e.type==='message_end'&&e.message?.role==='assistant');
  return {passed:failures.length===0,failures,deliveryFailures,injectionFailures,logicalModelResponses:payloads.length,modeCompliance:!failures.some(f=>/polled|cadence|fallback/.test(f))};
}
export function measures({started,finished,ledger,mcp,runtime,notifications,events}) {
  const tools=events.filter(e=>e.type==='tool_execution_start');
  const names=Object.fromEntries([...new Set(tools.map(e=>e.toolName))].map(name=>[name,tools.filter(e=>e.toolName===name).length]));
  const snapshots=notifications.filter(e=>e.type==='context_snapshot');
  const submit=runtime.find(e=>e.type==='plan_submitted');
  const postSubmissionWork=submit?[...runtime.filter(e=>['mcp_dispatch','files_read','file_written','files_verified','plan_submitted'].includes(e.type)&&e.monoMs>submit.monoMs),
    ...notifications.filter(e=>e.type==='notification_history'&&e.monoMs>submit.monoMs)].map(e=>({type:e.type,tool:e.name??null,elapsedMs:e.monoMs-submit.monoMs})):[];
  const jobs=mcp.filter(e=>e.type==='job_finished');
  const providerLatencies=runtime.filter(e=>e.type==='http_attempt').map(attempt=>{
    const end=runtime.find(e=>e.type==='raw_usage'&&e.requestId===attempt.requestId);
    const first=runtime.find(e=>e.type==='first_token'&&e.requestId===attempt.requestId);
    return {requestId:attempt.requestId,durationMs:end?end.monoMs-attempt.monoMs:null,firstTokenMs:first?first.monoMs-attempt.monoMs:null};
  });
  const reactions=jobs.map(job=>{
    const completion=job.finished?.monoMs??job.monoMs;
    const arrival=mcp.find(e=>e.type==='notify_accepted'&&e.jobId===job.jobId);
    const exposure=arrival?snapshots.find(e=>e.active.some(n=>n.id===arrival.notification.id)):null;
    const checks=mcp.filter(e=>['status_check','await_completed'].includes(e.type)&&e.monoMs>=completion);
    const acquired=exposure?.monoMs??checks[0]?.monoMs;
    return {jobId:job.jobId,timeSource:job.timeSource??'local_worker_finished',producerMs:completion-mcp.find(e=>e.type==='job_started'&&e.jobId===job.jobId).monoMs,
      deliveryMs:arrival?arrival.monoMs-completion:null,exposureMs:acquired===undefined?null:acquired-completion,
      reactionUpperBoundMs:submit?submit.monoMs-completion:null,exposedAtNaturalBoundary:!!exposure,
      receivedWhileAwaiting:!!arrival&&mcp.some(e=>e.type==='tools_call'&&e.name==='await_jobs'&&e.monoMs<arrival.monoMs)&&mcp.some(e=>e.type==='await_completed'&&e.monoMs>=arrival.monoMs)};
  });
  return {wallMs:finished.monoMs-started.monoMs,taskMs:submit?submit.monoMs-started.monoMs:null,
    providerAttempts:ledger.requests,logicalModelCalls:runtime.filter(e=>e.type==='context_boundary').length,
    tokens:ledger.tokens,estimatedUsd:ledger.estimatedUsd,unconfirmedReservedUsd:ledger.unconfirmedReservedUsd,
    cacheHitRate:ledger.tokens.cacheRead/Math.max(1,(ledger.tokens.input??0)+(ledger.tokens.cacheRead??0)+(ledger.tokens.cacheWrite??0)),
    toolCalls:tools.length,toolNames:names,mcpCalls:mcp.filter(e=>e.type==='tools_call').length,
    externalApiInvocations:mcp.filter(e=>e.type==='github_api').length,
    mcpProtocolMessages:mcp.filter(e=>e.type==='protocol_message').length,statusChecks:mcp.filter(e=>e.type==='status_check').length,
    notificationHttpAttempts:mcp.filter(e=>e.type==='notify_attempt').length,dismissCalls:names.notifications_dismiss??0,
    historyCalls:names.notifications_history??0,fallbackAwaits:names.await_jobs??0,
    notificationBytes:snapshots.reduce((sum,s)=>sum+Buffer.byteLength(s.block),0),
    injectionMs:snapshots.reduce((sum,s)=>sum+(s.durationMs??0),0),postSubmissionWorkCalls:postSubmissionWork.length,postSubmissionWork,reactions,providerLatencies,
    providerTotalMs:providerLatencies.reduce((a,r)=>a+(r.durationMs??0),0),
    pollingIntervalsMs:mcp.filter(e=>e.type==='status_check').map((e,i,a)=>i?e.monoMs-a[i-1].monoMs:null).filter(x=>x!==null),
    requestedPausesSeconds:mcp.filter(e=>e.type==='tools_call'&&e.name==='pause').map(e=>e.args.seconds)};
}
export const median=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2:null;};
export function verifyPayloads(mode,providers,notifications,{position,cache}={}){
  const errors=[];
  const snapshots=notifications.filter(e=>e.type==='context_snapshot');
  for(const p of providers){
    const strings=[];
    const visit=v=>{if(typeof v==='string')strings.push(v);else if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')Object.values(v).forEach(visit);};
    visit(p.payload);
    const blocks=strings.filter(s=>s.startsWith('<runtime_notifications>\n## Notifications'));
    if(mode==='N'){
      const snapshot=snapshots.find(s=>s.call===p.call);
      if(blocks.length!==1||!snapshot||blocks[0]!==snapshot.block)errors.push(`Payload ${p.call}/${p.attempt} differs from its snapshot`);
      const input=p.payload.input??[];
      const boundary=input.findIndex(item=>item.content?.some?.(part=>part.text?.startsWith('<runtime_notifications>\n## Notifications')));
      if(position==='tail'&&boundary!==input.length-1)errors.push(`Payload ${p.call}: notifications are not last`);
      if(position==='before-input'){
        const current=input.slice(boundary+1);
        if(boundary<0||!current.length||current.some(item=>item.role!=='user'&&item.type!=='function_call_output'))errors.push(`Payload ${p.call}: current input does not follow notifications`);
      }
    }else{
      if(blocks.length)errors.push('Disabled-context baseline contains a dynamic notification block');
      if(p.payload.tools?.some(tool=>['notifications_dismiss','notifications_history'].includes(tool.name)))errors.push('Disabled-context baseline exposes notification retrieval/lifecycle tools');
    }
    if(cache==='stable'){
      if(p.payload.prompt_cache_options?.mode!=='explicit')errors.push(`Payload ${p.call}: explicit cache mode missing`);
      const input=p.payload.input??[],marked=[];
      const boundary=mode==='N'?input.findIndex(item=>item.content?.some?.(part=>part.text?.startsWith('<runtime_notifications>\n## Notifications'))):input.length;
      const inspect=(value,index)=>{if(Array.isArray(value))value.forEach(v=>inspect(v,index));else if(value&&typeof value==='object'){
        if(value.prompt_cache_breakpoint)marked.push(index);Object.values(value).forEach(v=>inspect(v,index));
      }};
      input.forEach((item,index)=>inspect(item,index));
      if(!marked.length||marked.length>4||marked.some(index=>index>=boundary))errors.push(`Payload ${p.call}: cache breakpoint includes dynamic/current data or invalid count`);
    }
  }
  for(const dismissed of notifications.filter(e=>e.type==='notification_dismissed'&&e.dismissed)){
    if(snapshots.some(s=>s.monoMs>dismissed.monoMs&&s.active.some(n=>n.id===dismissed.id)))errors.push(`Dismissed ID returned: ${dismissed.id}`);
  }
  return {passed:errors.length===0&&providers.length>0,providerPayloads:providers.length,errors};
}
export function pairedComparison(runs,scenario,reference,metric,iterations=10000) {
  const value=r=>metric.split('.').reduce((a,k)=>a?.[k],r.metrics);
  const n=runs.filter(r=>r.scenario===scenario&&r.mode==='N'&&r.assessment.passed);
  const pairs=n.map(r=>{const b=runs.find(b=>b.scenario===scenario&&b.mode===reference&&b.seed===r.seed&&b.phase===r.phase&&b.assessment.passed);return b&&Number.isFinite(value(r))&&Number.isFinite(value(b))?{seed:r.seed,n:value(r),b:value(b)}:null;}).filter(Boolean);
  if(!pairs.length)return {scenario,reference,metric,pairs:0,medianSaving:null,ci95:null};
  const differences=pairs.map(p=>p.b-p.n),rng=random(731);
  const samples=Array.from({length:iterations},()=>median(Array.from({length:pairs.length},()=>differences[Math.floor(rng()*pairs.length)]))).sort((a,b)=>a-b);
  return {scenario,reference,metric,pairs:pairs.length,medianSaving:median(differences),
    medianSavingPct:median(pairs.map(p=>p.b>0?(p.b-p.n)/p.b*100:0)),ci95:[samples[Math.floor(iterations*.025)],samples[Math.floor(iterations*.975)]],evidence:pairs.length>=10?'confirmation':'exploratory'};
}
