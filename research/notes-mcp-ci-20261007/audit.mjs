import {readFileSync,readdirSync,statSync,existsSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// Post-run integrity/accounting audit only; never starts Pi or alters its app.
const root=fileURLToPath(new URL('.',import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
const rows=file=>readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const source=dir=>{const hashes={};const walk=(at,prefix='')=>{for(const name of readdirSync(at).sort()){const path=join(at,name),relative=join(prefix,name);if(statSync(path).isDirectory())walk(path,relative);else hashes[relative]=sha(readFileSync(path));}};walk(dir);return hashes;};
const component=(suite,files)=>sha(JSON.stringify(Object.fromEntries(Object.entries(files).filter(([path])=>path!=='mcp.mjs'&&path!=='web.mjs'||path===(suite==='mcp'?'mcp.mjs':suite==='web'?'web.mjs':'')))));
const manifestBytes=readFileSync(join(root,'input-manifest.json')),manifest=JSON.parse(manifestBytes),frozenHash=sha(manifestBytes);
const frozenInputs=Object.entries(manifest.hashes).map(([file,hash])=>({file,passed:sha(readFileSync(join(root,file)))===hash}));
const requested=process.argv.slice(2),ids=requested.length?requested:readdirSync(join(root,'runs')).filter(id=>id.startsWith('measured-')&&existsSync(join(root,'runs',id,'result.json')));
const audits=[];
for(const id of ids){
 const dir=join(root,'runs',id),result=JSON.parse(readFileSync(join(dir,'result.json'))),ci=rows(join(dir,'ci.jsonl')),trace=rows(join(dir,'trace.jsonl'));
 const snapshots=ci.filter(e=>e.type==='job_queued').map(queued=>{const files=source(join(dir,'snapshots',queued.jobId,'src')),published=ci.find(e=>e.type==='result_published'&&e.event.jobId===queued.jobId),started=ci.find(e=>e.type==='job_started'&&e.jobId===queued.jobId),completed=ci.find(e=>e.type==='job_completed'&&e.jobId===queued.jobId);return {jobId:queued.jobId,suite:queued.suite,revision:queued.revision,revisionMatches:sha(JSON.stringify(files))===queued.revision,componentMatches:component(queued.suite,files)===queued.componentHash,eventMatches:!!published&&published.event.revision===queued.revision&&published.event.componentHash===queued.componentHash&&(!published.event.snapshotFiles||JSON.stringify(published.event.snapshotFiles)===JSON.stringify(files)),queueMs:queued.queueDelayMs,actualQueueMs:started?started.monoMs-queued.monoMs:null,ordered:!!started&&!!completed&&!!published&&started.monoMs>=queued.monoMs+queued.queueDelayMs-1&&completed.monoMs>=started.monoMs&&published.monoMs>=completed.monoMs};});
 const appSource=source(join(dir,'app','src')),required=result.requiredCI.map(job=>({suite:job?.suite,passed:!!job&&job.state==='complete'&&job.passed&&component(job.suite,appSource)===job.componentHash}));
 const locked=['CONTRACT.md','package.json','test/smoke.test.mjs'].map(file=>({file,passed:sha(readFileSync(join(dir,'app',file)))===sha(readFileSync(join(root,file==='CONTRACT.md'?'contract.md':'scaffold/'+file)))}));
 const numeric=new Map(trace.filter(e=>e.type==='provider_usage'&&typeof e.usage?.input_tokens==='number'&&typeof e.usage?.output_tokens==='number').map(e=>[e.responseId,e])),pi=new Map(trace.filter(e=>e.type==='assistant_usage'&&e.stopReason!=='error').map(e=>[e.logical,e]));
 const responses=[...numeric.values()].map(raw=>{const assistant=pi.get(raw.logical);return {responseId:raw.responseId,input:raw.usage.input_tokens,output:raw.usage.output_tokens,cached:raw.usage.input_tokens_details?.cached_tokens??0,passed:!!assistant&&raw.usage.input_tokens===(assistant.usage.input??0)+(assistant.usage.cacheRead??0)+(assistant.usage.cacheWrite??0)&&raw.usage.output_tokens===assistant.usage.output};});
 const attempts=trace.filter(e=>e.type==='http_attempt'),successful=trace.filter(e=>e.type==='http_response'&&e.status===200),exposures=ci.filter(e=>e.type==='result_published').map(p=>{const request=trace.find(e=>e.type==='provider_request'&&e.monoMs>=p.monoMs&&e.visibleEventIds.includes(p.event.eventId));return {eventId:p.event.eventId,firstExposureMs:request?request.monoMs-p.monoMs:null,exposed:!!request,nonnegative:!request||request.monoMs>=p.monoMs};});
 const accountingPassed=responses.length===attempts.length&&pi.size===responses.length&&successful.length===attempts.length&&responses.every(e=>e.passed),checks={frozenManifest:result.inputManifestSha256===frozenHash,snapshots:snapshots.every(s=>s.revisionMatches&&s.componentMatches&&s.eventMatches&&s.ordered),requiredCI:required.every(s=>s.passed),lockedInputs:locked.every(s=>s.passed),oracle:result.oracle?.passed&&result.oracle.checks.length===9&&result.oracle.checks.every(c=>c.passed),rawAccounting:accountingPassed,exposureIntervals:exposures.every(e=>e.nonnegative),noPackagedAuth:!existsSync(join(dir,'auth.json'))&&!existsSync(join(dir,'config','auth.json'))};
 const audit={runId:id,generatedAt:new Date().toISOString(),frozenManifestSha256:frozenHash,checks,passed:Object.values(checks).every(Boolean),snapshots,required,locked,accounting:{httpAttempts:attempts.length,numericResponses:responses.length,piResponses:pi.size,input:responses.reduce((a,r)=>a+r.input,0),output:responses.reduce((a,r)=>a+r.output,0),cached:responses.reduce((a,r)=>a+r.cached,0),responses},exposures};
 writeFileSync(join(dir,'audit.json'),JSON.stringify(audit,null,2));audits.push(audit);
}
const report={generatedAt:new Date().toISOString(),auditRevision:sha(readFileSync(fileURLToPath(import.meta.url))),frozenInputs,passed:frozenInputs.every(f=>f.passed)&&audits.every(a=>a.passed),runs:audits.map(a=>({runId:a.runId,passed:a.passed,checks:a.checks}))};
writeFileSync(join(root,'audit.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));process.exitCode=report.passed?0:1;
