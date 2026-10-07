import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const data=readFileSync(process.argv[2]);
const rows=data.toString().trim().split('\n').map(JSON.parse);
const topics=Object.create(null);for(const row of rows)topics[row.topic]=(topics[row.topic]??0)+1;
const result={datasetSha256:createHash('sha256').update(data).digest('hex'),rows:rows.length,topics};
if(process.argv[3])writeFileSync(process.argv[3],JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
