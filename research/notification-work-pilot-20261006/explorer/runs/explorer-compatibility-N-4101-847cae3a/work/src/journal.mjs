import { DatabaseSync } from 'node:sqlite';
import { normalizeEvent } from './envelope.mjs';

export class Journal {
  #db;
  #closed = false;
  constructor(path) {
    this.#db = new DatabaseSync(path);
    this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, topic TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL);`);
  }
  record(input) {
    const e = normalizeEvent(input);
    const payload = JSON.stringify(e.payload);
    return this.#db.prepare(`INSERT INTO events (id,topic,revision,payload) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET topic=excluded.topic, revision=excluded.revision, payload=excluded.payload
      WHERE excluded.revision > events.revision`).run(e.id, e.topic, e.revision, payload).changes > 0;
  }
  get(id) {
    const row = this.#db.prepare('SELECT * FROM events WHERE id=?').get(id);
    return row ? { ...row, payload: JSON.parse(row.payload) } : undefined;
  }
  all() {
    return this.#db.prepare('SELECT * FROM events ORDER BY id').all().map(row => ({ ...row, payload: JSON.parse(row.payload) }));
  }
  close() { if (!this.#closed) { this.#db.close(); this.#closed = true; } }
}
