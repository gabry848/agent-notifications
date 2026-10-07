import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SCENARIOS } from './scenarios.mjs';

const [target, ...sources] = process.argv.slice(2);
if (!target || !sources.length) throw new Error('Usage: node experiments/consolidate.mjs baseline-final-v1 baseline-v1 retry-v1');
const selected = new Map();
const attempts = [];
let metadata;
for (const campaign of sources) {
  const data = JSON.parse(readFileSync(resolve('artifacts', campaign, 'summary.json'), 'utf8'));
  metadata ??= data;
  if (['prompt', 'provider', 'model', 'thinking'].some(k => data[k] !== metadata[k])) throw new Error('Campaign settings differ');
  for (const run of data.results) {
    const key = `${run.name}:${run.repetition}`;
    attempts.push({ campaign, name: run.name, repetition: run.repetition, started: run.started,
      finished: run.finished, error: run.error, behaviorPass: run.assessment.behaviorPass });
    selected.set(key, { ...run, campaign });
  }
}
const results = [...selected.values()].sort((a, b) => SCENARIOS.indexOf(a.name) - SCENARIOS.indexOf(b.name) || a.repetition - b.repetition);
const directory = resolve('artifacts', target);
mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, 'summary.json'), JSON.stringify({ campaign: target, prompt: metadata.prompt,
  provider: metadata.provider, model: metadata.model, thinking: metadata.thinking, sourceCampaigns: sources, attempts, results }, null, 2));
console.log(`Selected ${results.length} cases from ${attempts.length} attempts; ${attempts.filter(r => r.error).length} runtime errors retained in provenance.`);
