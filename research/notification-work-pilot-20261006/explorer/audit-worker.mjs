import { auditCorpus } from './fixture.mjs';
const [work,kind,seed]=process.argv.slice(2);
process.stdout.write(JSON.stringify(auditCorpus(work,{kind,seed:Number(seed)}))+'\n');
