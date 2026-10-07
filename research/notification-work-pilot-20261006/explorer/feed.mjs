import { EventEmitter } from 'node:events';
import { watch, readFileSync, appendFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { sourceHashes, verifyRelease, publicTests } from './fixture.mjs';

const exec=promisify(execFile);
export const stamp=()=>({time:new Date().toISOString(),monoMs:Number(process.hrtime.bigint())/1e6});
export function append(path,type,data={}){appendFileSync(path,JSON.stringify({...stamp(),type,...data})+'\n');}
export async function checkWork(work){
  let output='',exitCode=0;
  try{output=(await exec(process.execPath,['--test','--test-reporter=tap','--test-timeout=15000','public.test.mjs'],{cwd:work,timeout:20000,maxBuffer:250000})).stdout;}
  catch(e){output=(e.stdout??'')+'\n'+(e.stderr??'');exitCode=e.code??1;}
  return {passed:exitCode===0,exitCode,passedTests:Number(output.match(/^# pass (\d+)/m)?.[1]??0),failedTests:Number(output.match(/^# fail (\d+)/m)?.[1]??0),output};
}
export async function checkSupplementalWork(work){
  const files=[];
  const walk=(directory,relative='')=>{for(const item of readdirSync(directory,{withFileTypes:true})){
    const name=relative?relative+'/'+item.name:item.name;
    if(item.isDirectory()&&!['node_modules','.git','.pi'].includes(item.name))walk(join(directory,item.name),name);
    else if(item.isFile())files.push(name);
  }};walk(work);
  const additionalTests=files.filter(name=>name.endsWith('.test.mjs')&&name!=='public.test.mjs');
  const demoCandidates=files.filter(name=>name.endsWith('.mjs')&&!name.startsWith('src/')&&!name.endsWith('.test.mjs'))
    .filter(name=>{const code=readFileSync(join(work,name),'utf8');return code.includes('createHubServer')&&code.includes('configPath')&&code.includes('deployment.json');});
  const readmePresent=existsSync(join(work,'README.md'))&&readFileSync(join(work,'README.md'),'utf8').trim().length>100;
  let tests={passed:false,output:'No additional integration tests added'};
  if(additionalTests.length){try{const result=await exec(process.execPath,['--test','--test-reporter=tap','--test-timeout=15000',...additionalTests],{cwd:work,timeout:30000,maxBuffer:250000});tests={passed:true,output:result.stdout};}
    catch(e){tests={passed:false,output:(e.stdout??'')+'\n'+(e.stderr??'')};}}
  return {passed:readmePresent&&demoCandidates.length>0&&tests.passed,readmePresent,demoCandidates,additionalTests,tests,
    limitation:'CLI candidates are static wiring evidence, not a complete behavioral proof; independent audit must inspect them.'};
}

/** Real worker launched by an explicitly synthetic implementation-progress trigger. */
export class AuditFeed extends EventEmitter {
  constructor({work,run,kind,seed,trace,endpoint,mode,minPassedTests=3}){
    super();Object.assign(this,{work,run,kind,seed,trace,endpoint,mode,minPassedTests});
    this.updates=[];this.closed=false;this.checking=false;this.dirty=false;this.milestones=new Map();this.lastHashes={};
  }
  async start(){
    append(this.trace,'corpus_audit_scheduled',{startGate:'at least '+this.minPassedTests+' real public tests pass'});
    this.watcher=watch(join(this.work,'src'),()=>{this.dirty=true;this.inspect();});
    this.releaseWatcher=watch(this.work,(_event,name)=>{
      if(!['deployment.json','release-note.json'].includes(String(name)))return;
      if(!this.report){append(this.trace,'release_artifact_before_report',{name});return;}
      const result=verifyRelease(this.work,this.report);
      const deploymentCorrect=!!result.deployment&&!result.errors.some(e=>e.startsWith('deployment'));
      append(this.trace,'release_artifact_observed',{name,deploymentCorrect,releaseCorrect:result.passed,
        afterPublication:this.updates.length>0,deployment:result.deployment,note:result.note});
    });
    this.dirty=true;await this.inspect();
  }
  async inspect(){
    if(this.checking||this.closed)return;
    this.checking=true;
    try{do{
      this.dirty=false;const result=await checkWork(this.work);if(this.closed)break;
      const hashes=sourceHashes(this.work),changed=Object.keys(hashes).filter(k=>hashes[k]!==this.lastHashes[k]);
      this.lastHashes=hashes;
      append(this.trace,'work_checkpoint',{passed:result.passed,passedTests:result.passedTests,failedTests:result.failedTests,changed,hashes});
      const names=[...result.output.matchAll(/^ok \d+ - (.+)$/gm)].map(x=>x[1]);
      for(const name of names)if(!this.milestones.has(name)){this.milestones.set(name,stamp());append(this.trace,'first_test_pass',{name});}
      if(!this.updates.length&&result.passedTests>=this.minPassedTests)await this.publish();
    }while(this.dirty&&!this.closed);}finally{this.checking=false;}
  }
  async publish(){
    append(this.trace,'corpus_audit_start',{trigger:'verified implementation progress'});
    const {stdout}=await exec(process.execPath,[fileURLToPath(new URL('./audit-worker.mjs',import.meta.url)),this.work,this.kind,String(this.seed)],{timeout:20000,maxBuffer:100000});
    this.report=JSON.parse(stdout);
    append(this.trace,'corpus_audit_finished',{report:this.report});
    writeFileSync(join(this.run,'expected-report.json'),JSON.stringify(this.report,null,2));
    const update={sequence:1,report:this.report,...stamp()};this.updates.push(update);
    append(this.trace,'report_published',{update,passedMilestones:[...this.milestones.keys()]});
    if(this.mode==='N'){
      const body={sessionId:this.endpoint.sessionId,source:'external-corpus-auditor',id:'report-'+this.seed,message:JSON.stringify(this.report)};
      try{const response=await fetch(this.endpoint.url+'/notify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
        const result=await response.json();append(this.trace,'report_ingress',{status:response.status,result});
        if(!response.ok)throw new Error('HTTP '+response.status);
      }catch(e){append(this.trace,'report_ingress_error',{error:e.message});}
    }
    this.emit('update');
  }
  snapshot(after=0){return {updates:this.updates.filter(x=>x.sequence>after)};}
  async next(after=0,timeoutMs=120000){
    const immediate=this.snapshot(after);if(immediate.updates.length)return immediate;
    return await new Promise(resolve=>{let timer;
      const finish=()=>{clearTimeout(timer);this.off('update',finish);this.off('closed',finish);resolve(this.snapshot(after));};
      this.on('update',finish);this.on('closed',finish);timer=setTimeout(finish,timeoutMs);
    });
  }
  async finish(){
    this.watcher?.close();this.releaseWatcher?.close();this.closed=true;this.emit('closed');
    const tests=await checkWork(this.work),release=this.report?verifyRelease(this.work,this.report):{passed:false,errors:['producer did not start because useful progress was not observed']};
    tests.publicTestsUnmodified=readFileSync(join(this.work,'public.test.mjs'),'utf8')===publicTests;
    tests.passed=tests.passed&&tests.publicTestsUnmodified;
    const addedTestFiles=[]; // runner separately discovers/runs the agent's additional tests.
    const summary={tests,release,reportPublished:this.updates.length>0,milestones:[...this.milestones],addedTestFiles};
    writeFileSync(join(this.run,'oracle.json'),JSON.stringify(summary,null,2));return summary;
  }
}
