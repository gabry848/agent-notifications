import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export const ACCOUNTING = {
  provider: 'openai-codex', model: 'gpt-6.1-sol', currency: 'USD', actualBilling: null,
  estimateKind: 'API-equivalent; subscription billing unavailable',
  tariffProvenance: 'Existing verified campaign benchmark/meter.mjs and installed Pi 0.99.2 Codex catalog agree',
  perMillion: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  longContextThreshold: 272000,
  longPerMillion: { input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5 },
  maxOutputTokens: 128000, contextWindow: 272000,
  normalization: 'Raw input_tokens includes cached tokens; subtract cacheRead and cacheWrite once. Reasoning tokens are an output subset.',
  reserves: 'UTF-8 payload bytes + 8192 framing as input-token upper bound, all uncached at highest input/write tariff; maximum 128000 output tokens. Failed/unknown calls retain full reservation.',
  cachePolicy: 'Provider-native Codex cache only; no API-specific cache schema injected',
  transport: 'sse',
};

export function normalizeUsage(raw) {
  if (!raw || !Number.isFinite(raw.input_tokens) || !Number.isFinite(raw.output_tokens)) return null;
  const cacheRead = raw.input_tokens_details?.cached_tokens ?? 0;
  const cacheWrite = raw.input_tokens_details?.cache_write_tokens ?? 0;
  return { input: Math.max(0, raw.input_tokens - cacheRead - cacheWrite), cacheRead, cacheWrite,
    output: raw.output_tokens, reasoning: raw.output_tokens_details?.reasoning_tokens ?? 0,
    totalTokens: raw.total_tokens ?? raw.input_tokens + raw.output_tokens };
}
export function estimate(usage) {
  const size = usage.input + usage.cacheRead + usage.cacheWrite;
  const rates = size > ACCOUNTING.longContextThreshold ? ACCOUNTING.longPerMillion : ACCOUNTING.perMillion;
  return ['input','output','cacheRead','cacheWrite'].reduce((sum, k) => sum + usage[k] * rates[k], 0) / 1e6;
}
export function reserveAmount(payloadBytes) {
  const inputBound = payloadBytes + 8192;
  const rates = inputBound > ACCOUNTING.longContextThreshold ? ACCOUNTING.longPerMillion : ACCOUNTING.perMillion;
  return (inputBound * Math.max(rates.input, rates.cacheWrite) + ACCOUNTING.maxOutputTokens * rates.output) / 1e6;
}
export class PilotLedger {
  constructor(path, { globalCap = 10, scopeCap = 6, scope = 'suite' } = {}) {
    this.db = new DatabaseSync(path); this.globalCap = globalCap; this.scopeCap = scopeCap; this.scope = scope;
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS pilot_requests(id TEXT PRIMARY KEY, scope TEXT NOT NULL, run_id TEXT NOT NULL,
        started_at TEXT NOT NULL, payload_bytes INTEGER NOT NULL, reserved REAL NOT NULL, estimated REAL,
        status INTEGER, response_id TEXT UNIQUE, raw_usage TEXT, normalized_usage TEXT, state TEXT NOT NULL);`);
  }
  spent(scope) {
    const clause = scope ? ' WHERE scope=?' : '';
    return this.db.prepare('SELECT COALESCE(SUM(COALESCE(estimated,reserved)),0) AS n FROM pilot_requests'+clause)
      .get(...(scope ? [scope] : [])).n;
  }
  reserve(runId, payloadBytes) {
    const amount = reserveAmount(payloadBytes);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.spent() + amount > this.globalCap || this.spent(this.scope) + amount > this.scopeCap)
        throw new Error('pilot usage limit: conservative reservation exceeds budget');
      const id = randomUUID();
      this.db.prepare(`INSERT INTO pilot_requests(id,scope,run_id,started_at,payload_bytes,reserved,state)
        VALUES(?,?,?,?,?,?,'pending')`).run(id,this.scope,runId,new Date().toISOString(),payloadBytes,amount);
      this.db.exec('COMMIT'); return id;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  status(id, status) { this.db.prepare('UPDATE pilot_requests SET status=? WHERE id=?').run(status,id); }
  unknown(id) { this.db.prepare("UPDATE pilot_requests SET state='unknown' WHERE id=? AND estimated IS NULL").run(id); }
  settle(id, responseId, raw) {
    const usage = normalizeUsage(raw); if (!usage || !id) return false;
    const amount = estimate(usage);
    const row = this.db.prepare('SELECT * FROM pilot_requests WHERE id=?').get(id);
    if (!row || row.estimated !== null) return false;
    if (amount > row.reserved) throw new Error('Estimated usage exceeds conservative reservation');
    this.db.prepare(`UPDATE pilot_requests SET estimated=?,response_id=?,raw_usage=?,normalized_usage=?,state='settled' WHERE id=?`)
      .run(amount,responseId ?? id,JSON.stringify(raw),JSON.stringify(usage),id);
    return true;
  }
  summary(runId) {
    const rows = this.db.prepare('SELECT * FROM pilot_requests'+(runId ? ' WHERE run_id=?' : ''))
      .all(...(runId ? [runId] : []));
    return { accounting: ACCOUNTING, attempts: rows.length, estimatedUsd: rows.reduce((n,r)=>n+(r.estimated??0),0),
      unknownReservedUsd: rows.filter(r=>r.estimated===null).reduce((n,r)=>n+r.reserved,0),
      rows: rows.map(r=>({...r,raw_usage:r.raw_usage?JSON.parse(r.raw_usage):null,
        normalized_usage:r.normalized_usage?JSON.parse(r.normalized_usage):null})) };
  }
  close() { this.db.close(); }
}
