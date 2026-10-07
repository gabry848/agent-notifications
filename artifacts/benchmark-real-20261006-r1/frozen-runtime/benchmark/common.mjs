import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const stamp = () => ({ time: new Date().toISOString(), monoMs: Number(process.hrtime.bigint()) / 1e6 });
export const log = (path, type, data = {}) => appendFileSync(path, JSON.stringify({ ...stamp(), type, ...data }) + '\n');
export const json = path => JSON.parse(readFileSync(path, 'utf8'));
export const lines = path => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
export const save = (path, value) => { writeFileSync(path + '.tmp', JSON.stringify(value, null, 2)); renameSync(path + '.tmp', path); };
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export const redact = value => String(value).replace(/sk-[a-zA-Z0-9_-]{8,}/g, '[REDACTED]').replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]');
export function random(seed) {
  let n = seed >>> 0;
  return () => { n += 0x6D2B79F5; let t = Math.imul(n ^ n >>> 15, 1 | n); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function shuffled(values, seed) {
  const a = [...values], rng = random(seed);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
