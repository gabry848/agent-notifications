import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { OPEN_MARKER } from '../src/store.mjs';

const campaigns = process.argv.slice(2);
if (!campaigns.length) throw new Error('Pass campaign names, e.g. baseline-v1 refined-v2');
const lines = path => readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const strings = value => typeof value === 'string' ? [value] : Array.isArray(value)
  ? value.flatMap(strings) : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
const results = [];
for (const campaign of campaigns) {
  const campaignPath = resolve('artifacts', campaign);
  const summary = JSON.parse(readFileSync(join(campaignPath, 'summary.json'), 'utf8'));
  const prompt = readFileSync(resolve('prompts', `${summary.prompt}.txt`), 'utf8').trim();
  for (const run of summary.results) {
    const directory = join(resolve('artifacts', run.campaign ?? campaign), `${run.name}-${run.repetition}`);
    const trace = lines(join(directory, 'runtime.jsonl'));
    const providers = lines(join(directory, 'provider.jsonl'));
    const snapshots = trace.filter(t => t.type === 'context_snapshot');
    const problems = [];
    for (const snapshot of snapshots) {
      if (new Set(snapshot.active.map(n => n.id)).size !== snapshot.active.length) problems.push('Duplicate active notification ID');
      for (const n of snapshot.active) {
        if (n.turnAge !== snapshot.call - n.firstVisibleCall) problems.push('Incorrect turn age');
        const dismissIndex = trace.findIndex(t => t.type === 'notification_dismissed' && t.id === n.id && t.dismissed);
        if (dismissIndex >= 0 && trace.indexOf(snapshot) > dismissIndex) problems.push('Dismissed event still active');
      }
    }
    for (const provider of providers) {
      const text = strings(provider.payload);
      const blocks = text.filter(t => t.startsWith(OPEN_MARKER + '\n## Notifications'));
      const snapshot = snapshots.find(s => s.call === provider.call);
      if (blocks.length !== 1 || blocks[0] !== snapshot?.block) problems.push('Provider block differs from runtime snapshot');
      const copies = text.reduce((sum, t) => sum + t.split(prompt).length - 1, 0);
      if (copies !== 1) problems.push(`Static instructions appear ${copies} times`);
    }
    results.push({ campaign, name: run.name, repetition: run.repetition, passed: !problems.length, problems: [...new Set(problems)] });
  }
}
const output = resolve('artifacts', 'verification.json');
writeFileSync(output, JSON.stringify({ results }, null, 2));
for (const r of results.filter(r => !r.passed)) console.log(`${r.campaign}/${r.name}-${r.repetition}: ${r.problems.join('; ')}`);
console.log(`Artifact verification: ${results.filter(r => r.passed).length}/${results.length} passed. ${output}`);
if (results.some(r => !r.passed)) process.exitCode = 1;
