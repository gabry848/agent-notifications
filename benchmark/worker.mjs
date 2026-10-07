import { writeFileSync } from 'node:fs';
import { json, pause, stamp } from './common.mjs';
const [specPath, id, output] = process.argv.slice(2);
const spec = json(specPath), job = spec.jobs.find(j => j.id === id);
await pause(job.durationMs);
writeFileSync(output, JSON.stringify({ jobId: id, revision: 1, status: job.status, result: job.result, finished: stamp() }));
process.exitCode = job.status === 'failed' ? 1 : 0;
