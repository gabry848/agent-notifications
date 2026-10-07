import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { signatures } from '../suite/generate.mjs';

const directory = resolve(process.argv[2]);
const output = resolve(process.argv[3] ?? join(import.meta.dirname,'supplemental-oracle.json'));
const checks = [], errors = [];
const record = (name, passed, detail) => {checks.push({name,passed,...(detail?{detail}:{})});if(!passed)errors.push(name);};
try {
  const entry = await import(pathToFileURL(join(directory,'src/index.mjs')).href);
  const functions = Object.entries(signatures).flatMap(([role,list])=>list.map(s=>({role,name:s.slice(0,s.indexOf('('))})));
  record('all-eighteen-public-functions-preserved',functions.every(({name})=>typeof entry[name]==='function'),
    functions.map(({role,name})=>({role,name,present:typeof entry[name]==='function'})));
  const view = await import(pathToFileURL(join(directory,'src/pipeline/view.mjs')).href);
  record('observed-policy-is-192',view.POLICY?.maxMessageChars===192);
  const message='Z'.repeat(350), event={eventId:'probe',source:'audit',message,
    occurredAt:'2026-10-06T10:00:00Z',receivedCall:1,target:'audit-session',dismissedAt:null};
  const expectedText='Z'.repeat(191)+'…';
  const compact=view.compactMessage(message);
  record('compact-default-uses-current-policy',compact.text===expectedText&&compact.truncated===true);
  const expectedLine='- [probe] 2026-10-06T10:00:00Z t-2 audit: '+expectedText;
  record('render-notification-default-uses-current-policy',view.renderNotification(event,3)===expectedLine);
  record('render-context-default-uses-current-policy',view.renderContext([event],'audit-session',3)===expectedLine);
  // Change only the isolated process's in-memory exported policy. No fixture is written.
  const original=view.POLICY.maxMessageChars;
  try {
    view.POLICY.maxMessageChars=207;
    record('render-observes-policy-without-hardcoded-limit',view.renderNotification(event,3)==='- [probe] 2026-10-06T10:00:00Z t-2 audit: '+'Z'.repeat(206)+'…');
  } finally {view.POLICY.maxMessageChars=original;}
  const handoff=readFileSync(join(directory,'docs/handoff.md'),'utf8');
  record('all-role-handoff-sections-preserved',Object.keys(signatures).every(role=>{
    const section=handoff.split('## '+role+'\n')[1]?.split('\n## ')[0];
    return !!section&&section.trim()!=='Pending.';
  }));
} catch (error) {errors.push(error.message);}
const result={auditedAt:new Date().toISOString(),directory,readOnlyFixture:true,newModelCalls:0,
  passed:errors.length===0,checks,errors,limits:['Final runtime actor attribution and cleanup require run logs.','No performance or ten-minute duration conclusion from these functional probes.']};
writeFileSync(output,JSON.stringify(result,null,2));
console.log(JSON.stringify({output,passed:result.passed,checks:checks.length,errors}));
if (!result.passed) process.exitCode=1;
