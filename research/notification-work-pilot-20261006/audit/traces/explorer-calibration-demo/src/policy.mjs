import { readFileSync } from 'node:fs';
export function loadPolicy(path) {
  let p;
  try { p = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { throw new TypeError('Cannot read deployment JSON', { cause: error }); }
  if (!p || !Number.isInteger(p.maxPayloadBytes) || p.maxPayloadBytes <= 0 ||
      !Number.isInteger(p.retryCapMs) || p.retryCapMs <= 0 ||
      typeof p.preferredRegion !== 'string' || !p.preferredRegion.trim() ||
      !Number.isInteger(p.auditRevision) || p.auditRevision < 0) throw new TypeError('Invalid deployment policy');
  const { maxPayloadBytes, retryCapMs, preferredRegion, auditRevision } = p;
  return { maxPayloadBytes, retryCapMs, preferredRegion, auditRevision };
}
