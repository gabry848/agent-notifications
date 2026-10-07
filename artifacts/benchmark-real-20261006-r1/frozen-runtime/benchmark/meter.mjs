import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export const PRICING = {
  model: 'gpt-6.1-sol', currency: 'USD', tier: 'default', checkedAt: '2026-10-06',
  source: 'https://developers.openai.com/api/docs/models/gpt-6.1-sol',
  perMillion: { input: 2, cacheRead: 0.1, cacheWrite: 2.5, output: 10 },
  longContextThreshold: 272000,
};
export const PHASE_LIMITS = { pilot: 8, main: 50, refine: 65, confirm: 90, utility: 90, github: 100 };

export function usageFromRaw(raw) {
  if (!raw || !Number.isFinite(raw.input_tokens) || !Number.isFinite(raw.output_tokens)) return null;
  const cacheRead = raw.input_tokens_details?.cached_tokens ?? 0;
  const cacheWrite = raw.input_tokens_details?.cache_write_tokens ?? 0;
  return { input: Math.max(0, raw.input_tokens - cacheRead - cacheWrite), cacheRead, cacheWrite,
    output: raw.output_tokens, reasoning: raw.output_tokens_details?.reasoning_tokens,
    totalTokens: raw.total_tokens ?? raw.input_tokens + raw.output_tokens };
}
export function cost(usage, { regional = false } = {}) {
  const inputTotal = usage.input + usage.cacheRead + usage.cacheWrite;
  const long = inputTotal > PRICING.longContextThreshold;
  const p = PRICING.perMillion;
  return ((usage.input * p.input + usage.cacheRead * p.cacheRead + usage.cacheWrite * p.cacheWrite) * (long ? 2 : 1)
    + usage.output * p.output * (long ? 1.5 : 1)) / 1e6 * (regional ? 1.1 : 1);
}
// Serialized UTF-8 bytes overestimate text token count. Include room for tool framing;
// reserve at long-context rates with regional premium, always Standard processing.
export const reservation = payload => (Buffer.byteLength(JSON.stringify(payload)) + 8192) * 5.5 / 1e6 + 4096 * 16.5 / 1e6;

export class Ledger {
  constructor(path, limit = 100) {
    this.db = new DatabaseSync(path); this.limit = Math.min(limit, 100);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, run_id TEXT NOT NULL, phase TEXT NOT NULL,
        reserved REAL NOT NULL, cost REAL, response_id TEXT UNIQUE, usage TEXT, state TEXT NOT NULL DEFAULT 'pending');
      CREATE TABLE IF NOT EXISTS external_costs(id TEXT PRIMARY KEY, reserved REAL NOT NULL, cost REAL, description TEXT NOT NULL);`);
  }
  total() {
    const requests = this.db.prepare('SELECT COALESCE(SUM(COALESCE(cost,reserved)),0) AS total FROM requests').get().total;
    return requests + this.db.prepare('SELECT COALESCE(SUM(COALESCE(cost,reserved)),0) AS total FROM external_costs').get().total;
  }
  reserve(runId, phase, payload) {
    const amount = reservation(payload), limit = Math.min(this.limit, PHASE_LIMITS[phase] ?? 0);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.total() + amount > limit) throw new Error(`Budget limit: ${phase} (${limit} USD)`);
      const id = randomUUID();
      this.db.prepare('INSERT INTO requests(id,run_id,phase,reserved) VALUES (?,?,?,?)').run(id, runId, phase, amount);
      this.db.exec('COMMIT'); return id;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  settle(id, usage, responseId) {
    if (!usage || !id) return;
    const amount = cost(usage);
    const row = this.db.prepare('SELECT reserved,state FROM requests WHERE id=?').get(id);
    if (!row || row.state !== 'pending') return;
    this.db.prepare("UPDATE requests SET cost=?,response_id=?,usage=?,state='settled' WHERE id=?")
      .run(amount, responseId ?? id, JSON.stringify(usage), id);
    if (amount > row.reserved) throw new Error('Actual estimated cost exceeded conservative reservation');
  }
  unknown(id) { if (id) this.db.prepare("UPDATE requests SET state='unknown' WHERE id=? AND state='pending'").run(id); }
  external(id, amount, description) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing=this.db.prepare('SELECT reserved FROM external_costs WHERE id=?').get(id);
      if(existing){if(existing.reserved!==amount)throw new Error('External reservation changed');this.db.exec('COMMIT');return;}
      if (this.total() + amount > this.limit) throw new Error('External cost would exceed total budget');
      this.db.prepare('INSERT INTO external_costs(id,reserved,description) VALUES (?,?,?)').run(id, amount, description);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  estimateExternal(id,amount){
    const row=this.db.prepare('SELECT reserved FROM external_costs WHERE id=?').get(id);
    if(!row||amount>row.reserved)throw new Error('External estimate exceeds reservation');
    this.db.prepare('UPDATE external_costs SET cost=? WHERE id=?').run(amount,id);
  }
  externalSummary(){
    const rows=this.db.prepare('SELECT * FROM external_costs').all();
    return {rows,estimatedUsd:rows.reduce((a,r)=>a+(r.cost??0),0),unconfirmedReservedUsd:rows.filter(r=>r.cost===null).reduce((a,r)=>a+r.reserved,0)};
  }
  summary(runId) {
    const rows = this.db.prepare(`SELECT * FROM requests ${runId ? 'WHERE run_id=?' : ''}`).all(...(runId ? [runId] : []));
    return { requests: rows.length, estimatedUsd: rows.reduce((n,r) => n + (r.cost ?? 0), 0),
      unconfirmedReservedUsd: rows.filter(r => r.cost === null).reduce((n,r) => n + r.reserved, 0),
      tokens: rows.reduce((a,r) => { const u = r.usage ? JSON.parse(r.usage) : {};
        for (const k of ['input','output','cacheRead','cacheWrite','totalTokens','reasoning']) a[k] = (a[k] ?? 0) + (u[k] ?? 0);
        return a; }, {}), rows: rows.map(r => ({ ...r, usage: r.usage ? JSON.parse(r.usage) : null })) };
  }
  close() { this.db.close(); }
}
