import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { roles, tests } from './generate.mjs';

export async function verify(directory,{requireExternal=true}={}) {
  directory=resolve(directory);
  const commands=roles.map(r=>`test/${r}.test.mjs`).concat('test/integration.test.mjs');
  const result=spawnSync(process.execPath,['--test',...commands],{cwd:directory,encoding:'utf8'});
  const untouchedTests=roles.every(r=>readFileSync(join(directory,'test',`${r}.test.mjs`),'utf8')===tests[r]);
  const digest=createHash('sha256').update(readFileSync(join(directory,'dataset.jsonl'))).digest('hex');
  const reports=Object.fromEntries(roles.map(r=>[r,existsSync(join(directory,'results',`${r}.json`))?JSON.parse(readFileSync(join(directory,'results',`${r}.json`),'utf8')):null]));
  const receiptCorrect=Object.values(reports).some(r=>r?.receiptDigest===digest);
  const handoff=readFileSync(join(directory,'docs/handoff.md'),'utf8');
  const handoffComplete=roles.every(r=>{const section=handoff.split(`## ${r}\n`)[1]?.split('\n## ')[0];return section&&section.trim()!=='Pending.';});
  let policy,policyError;
  try{const view=await import(pathToFileURL(join(directory,'src/pipeline/view.mjs')).href+`?oracle=${Date.now()}`);policy=view.POLICY?.maxMessageChars;}catch(e){policyError=e.message;}
  return {passed:result.status===0&&untouchedTests&&handoffComplete&&(!requireExternal||(receiptCorrect&&policy===192)),testsStatus:result.status,stdout:result.stdout,stderr:result.stderr,untouchedTests,handoffComplete,receiptCorrect,datasetSha256:digest,reports,policy,policyError,
    limits:['Task oracle is separate from actor file-scope and notification/board cleanup checks, which require runtime traces.','Only one paired group per mode; exploratory observations, no statistical confirmation.']};
}
if(process.argv[1]===new URL(import.meta.url).pathname)console.log(JSON.stringify(await verify(process.argv[2]),null,2));
