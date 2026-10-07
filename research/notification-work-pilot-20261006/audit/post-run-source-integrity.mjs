import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const campaign = resolve(import.meta.dirname, '..');
const project = resolve(campaign, '../..');
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const ready = readJson(join(campaign, 'adapter/ready.json'));
const suite = readJson(join(campaign, 'suite/runtime-frozen.json'));
const explorer = readJson(join(import.meta.dirname, 'explorer-first-GO.json'));
const check = (kind, root, hashes) => ({
  kind,
  files: Object.entries(hashes).map(([file, expected]) => {
    const actual = hash(join(root, file));
    return { file, expected, actual, matched: actual === expected };
  }),
});
const checks = [
  check('adapter', ready.root, ready.sha256),
  check('suite-v3', project, suite.sourceHashes),
  check('explorer-first-calibration', join(campaign, 'explorer'), explorer.explorerHashes),
];
const mismatches = checks.flatMap(c => c.files.filter(f => !f.matched).map(f => ({ kind: c.kind, ...f })));
const result = {
  auditedAt: new Date().toISOString(),
  modelCalls: 0,
  checks,
  mismatches,
  passed: mismatches.length === 0,
  limit: 'This post-run check proves the files currently match their frozen manifests; it is not continuous filesystem monitoring.',
};
writeFileSync(join(import.meta.dirname, 'post-run-source-integrity.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ passed: result.passed, filesBySet: checks.map(c => ({ kind: c.kind, count: c.files.length })), mismatches: mismatches.length }));
if (!result.passed) process.exitCode = 1;
