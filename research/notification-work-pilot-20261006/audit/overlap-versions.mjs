import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const campaign=resolve(import.meta.dirname,'..'),cases=[];
for(const mode of ['PA','N']) {
  const group=join(campaign,'suite/traces','group-'+mode);
  const summary=JSON.parse(readFileSync(join(group,'summary.json'),'utf8'));
  const participants=[];
  for(const participant of summary.participants) {
    const role=participant.role,rolePath=`src/pipeline/${role}.mjs`;
    const telemetry=readFileSync(join(group,role,'telemetry.jsonl'),'utf8').split('\n').filter(Boolean).map(JSON.parse);
    let hash=telemetry.find(r=>r.type==='session_started')?.baseline?.[rolePath]?.hash;
    const calls=[],versions=new Map();
    for(const finish of telemetry.filter(r=>r.type==='tool_finish')) {
      for(const change of finish.changes??[])if(change.path===rolePath)hash=change.hash;
      if(finish.name!=='bash'||!finish.args.command?.includes('--test')||!finish.args.command?.includes(role)||!/fail\s+0\b/.test((finish.content??[]).join('\n')))continue;
      const peers=summary.participants.filter(p=>p.role!==role&&p.promptStart.monoMs<=finish.monoMs&&p.promptEnd.monoMs>finish.monoMs).map(p=>p.role);
      if(!peers.length)continue;
      const event={time:finish.time,roleSourceHash:hash,command:finish.args.command,openPeerTurns:peers};
      calls.push(event);if(hash&&!versions.has(hash))versions.set(hash,event);
    }
    participants.push({role,verificationCallsDuringPeerTurn:calls.length,uniqueRoleSourceVersionsVerifiedDuringPeerTurn:versions.size,calls,versions:[...versions.values()]});
  }
  cases.push({mode,verificationCallsDuringPeerTurn:participants.reduce((s,p)=>s+p.verificationCallsDuringPeerTurn,0),uniqueRoleSourceVersionsVerifiedDuringPeerTurn:participants.reduce((s,p)=>s+p.uniqueRoleSourceVersionsVerifiedDuringPeerTurn,0),participants});
}
const result={auditedAt:new Date().toISOString(),newModelCalls:0,testsRepeated:false,cases,
  definition:'A successful role-specific test command while any other real Pi turn is open; each role/source SHA counts once.',
  limits:['Conservative: new tests on unchanged implementation do not add another source version.','An open peer turn does not prove continuous peer computation or external long-job overlap.','A source snapshot after a combined bash command must be checked for post-test writes. Inspected commands contain tests only, apart from sequential npm test.']};
writeFileSync(join(import.meta.dirname,'overlap-versions.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(cases.map(({participants,...c})=>({...c,participants:participants.map(({calls,versions,...p})=>p)}))));
