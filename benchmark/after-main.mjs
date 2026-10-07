import { join,resolve } from 'node:path';
import { existsSync,readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { save,log,pause } from './common.mjs';

const exec=promisify(execFile),campaign=process.argv[2]??'benchmark-real-20261006-r1';
const ROOT=resolve(fileURLToPath(new URL('..',import.meta.url)));
const directory=resolve(ROOT,'artifacts',campaign),progress=join(directory,'campaign-progress.json'),trace=join(directory,'campaign-driver.jsonl');
const stage=(phase,status,extra={})=>{save(progress,{phase,status,pid:process.pid,time:new Date().toISOString(),...extra});log(trace,'phase',{phase,status,...extra});console.log(`CAMPAIGN ${phase} ${status}`);};
let phase='main';
try{
  stage(phase,'waiting');
  const deadline=Date.now()+7200000;
  while(readdirSync(directory,{withFileTypes:true}).filter(d=>d.isDirectory()&&d.name.startsWith('main-')&&existsSync(join(directory,d.name,'summary.json'))).length<120){
    if(Date.now()>deadline)throw new Error('Main campaign has not completed 120 cases within two hours; preserving all attempts');
    await pause(1000);
  }
  phase='refine';stage(phase,'running');await (await import('./refine.mjs')).refine(campaign);stage(phase,'completed');
  phase='confirm';stage(phase,'running');await (await import('./confirm.mjs')).confirm(campaign);stage(phase,'completed');
  phase='utility';stage(phase,'running');
  const utility=await exec(process.execPath,['benchmark/utility.mjs',campaign],{cwd:ROOT,timeout:1200000,maxBuffer:100000});process.stdout.write(utility.stdout);stage(phase,'completed');
  phase='github';stage(phase,'running');await (await import('./github/run.mjs')).github(campaign);stage(phase,'completed');
  phase='regression';stage(phase,'running');
  const tests=await exec('npm',['test'],{cwd:ROOT,timeout:120000,maxBuffer:100000});save(join(directory,'regression.json'),{passed:true,output:tests.stdout});
  const integration=await exec('npm',['run','test:pi'],{cwd:ROOT,timeout:120000,maxBuffer:100000});save(join(directory,'pi-regression.json'),{passed:true,output:integration.stdout});stage(phase,'completed');
  phase='report';stage(phase,'running');const result=(await import('./report.mjs')).report(directory);stage(phase,'completed',{runs:result.runs.length,costs:result.costs,holdout:result.conclusions.status});
  stage('campaign','completed');
}catch(error){stage(phase,'interrupted',{error:error.message});(await import('./report.mjs')).report(directory);process.exitCode=1;}
