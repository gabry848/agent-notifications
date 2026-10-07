import { join,resolve } from 'node:path';
import { ROOT } from './run.mjs';
import { json,save,log,pause } from './common.mjs';
import { github } from './github/run.mjs';
import { report } from './report.mjs';

const campaign=process.argv[2]??'benchmark-real-20261006-r1';
const resume=process.argv.includes('--resume');
const attemptIndex=process.argv.indexOf('--attempt');
const attempt=attemptIndex<0?'supplemental':process.argv[attemptIndex+1];
const directory=resolve(ROOT,'artifacts',campaign);
const progress=join(directory,'campaign-progress.json');
const stage=(phase,status,extra={})=>{
  save(progress,{phase,status,pid:process.pid,time:new Date().toISOString(),...extra});
  log(join(directory,'campaign-driver.jsonl'),'phase',{phase,status,...extra});
  console.log(`RECOVERY ${phase} ${status}`);
};
let phase='waiting';
try{
  if(resume){
    if(!json(join(directory,'regression.json')).passed||!json(join(directory,'pi-regression.json')).passed)
      throw Error('Initial regressions must pass before supplemental resume');
    json(join(directory,'github-cleanup.json'));
  }else{
    const deadline=Date.now()+3600000;
    while(true){
      const state=json(progress);
      if(state.phase==='campaign'&&state.status==='completed')break;
      if(state.status==='interrupted')throw Error(`Initial driver interrupted in ${state.phase}: ${state.error}`);
      if(Date.now()>deadline)throw Error('Initial driver has not finished; no concurrent Pi trials started');
      await pause(1000);
    }
  }
  const repair=json(join(directory,'github-adapter-repair.json'));
  const order=['N','P10'].map(mode=>({outcome:repair.supplementaryPair.outcome,seed:repair.supplementaryPair.seed,mode}));
  phase='github-supplemental';stage(phase,'running');
  await github(campaign,{order,attempt});stage(phase,'completed');
  phase='report';stage(phase,'running');
  const output=report(directory);
  save(join(directory,'github-recovery.json'),{completedAt:new Date().toISOString(),order,
    preservedFailure:repair.failedRunId,githubCases:output.runs.filter(r=>r.phase==='github').length,
    githubCorrect:output.runs.filter(r=>r.phase==='github'&&r.assessment.passed).length});
  stage(phase,'completed',{runs:output.runs.length,costs:output.costs});
  stage('campaign','completed',{supplementalCompleted:true});
}catch(error){stage(phase,'interrupted',{error:error.message});process.exitCode=1;}
