import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const CONTEXT_TYPE = 'dynamic-notification-memory';
export const OPEN_MARKER = '<runtime_notifications>';
export const CLOSE_MARKER = '</runtime_notifications>';

const validateSessionId = value => {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    throw new Error('sessionId must be a non-empty string of at most 128 characters');
  }
  return value;
};
const notificationFromRow = row => ({
  id: row.id, sessionId: row.session_id, source: row.source, message: row.message,
  createdAt: row.created_at, firstVisibleCall: row.first_visible_call, dismissedAt: row.dismissed_at,
});

export class NotificationStore {
  constructor({ path = ':memory:', sessionId = 'default', clock = () => new Date(), id = () => `notif_${randomUUID()}` } = {}) {
    this.clock = clock;
    this.id = id;
    this.sessionId = validateSessionId(sessionId);
    if (typeof path !== 'string' || !path) throw new Error('A database path is required');
    this.databasePath = path === ':memory:' ? path : resolve(path);
    if (path !== ':memory:') mkdirSync(dirname(this.databasePath), { recursive: true });
    this.connection = { db: new DatabaseSync(this.databasePath), closed: false };
    try {
      this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      if (version > 1) throw new Error(`Unsupported notifications database version: ${version}`);
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            call_count INTEGER NOT NULL DEFAULT 0 CHECK (call_count >= 0)
          );
          CREATE TABLE IF NOT EXISTS notifications (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            id TEXT NOT NULL UNIQUE,
            session_id TEXT NOT NULL REFERENCES sessions(id),
            source TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL,
            first_visible_call INTEGER CHECK (first_visible_call >= 1),
            dismissed_at TEXT
          );
          CREATE INDEX IF NOT EXISTS notifications_active
            ON notifications(session_id, sequence) WHERE dismissed_at IS NULL;
          CREATE INDEX IF NOT EXISTS notifications_history
            ON notifications(session_id, sequence DESC);
          PRAGMA user_version = 1;
        `);
      });
      this.ensureSession();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  get db() { return this.connection.db; }
  get call() { return this.db.prepare('SELECT call_count FROM sessions WHERE id = ?').get(this.sessionId).call_count; }

  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  ensureSession(create = true) {
    if (create) this.db.prepare('INSERT OR IGNORE INTO sessions(id) VALUES (?)').run(this.sessionId);
    else if (!this.db.prepare('SELECT id FROM sessions WHERE id = ?').get(this.sessionId)) {
      throw new Error(`Unknown notification session: ${this.sessionId}`);
    }
  }

  // Session views share one connection; closing any view closes that connection.
  forSession(sessionId, { create = true } = {}) {
    const scoped = Object.create(NotificationStore.prototype);
    Object.assign(scoped, { clock: this.clock, id: this.id, connection: this.connection,
      databasePath: this.databasePath, sessionId: validateSessionId(sessionId) });
    scoped.ensureSession(create);
    return scoped;
  }

  close() {
    if (!this.connection.closed) {
      this.db.close();
      this.connection.closed = true;
    }
  }

  add({ source, message, eventId }) {
    if (typeof source !== 'string' || !source.trim() || source.length > 120 ||
        typeof message !== 'string' || !message.trim() || message.length > 8000) {
      throw new Error('source (1–120 chars) and message (1–8000 chars) are required');
    }
    if (eventId !== undefined && (typeof eventId !== 'string' || !eventId || eventId.length > 256)) {
      throw new Error('eventId must be a non-empty string of at most 256 characters');
    }
    const id = eventId === undefined ? this.id() : 'notif_' + createHash('sha256')
      .update(JSON.stringify([this.sessionId, source, eventId])).digest('hex');
    const row = this.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
      if (previous) {
        if (previous.source !== source || previous.message !== message) throw new Error('eventId payload conflict');
        return previous;
      }
      return this.db.prepare(`INSERT INTO notifications(id, session_id, source, message, created_at)
        VALUES (?, ?, ?, ?, ?) RETURNING *`).get(id, this.sessionId, source, message, this.clock().toISOString());
    });
    return notificationFromRow(row);
  }

  dismiss(id) {
    const row = this.db.prepare(`UPDATE notifications SET dismissed_at = COALESCE(dismissed_at, ?)
      WHERE id = ? AND session_id = ? RETURNING id`).get(this.clock().toISOString(), id, this.sessionId);
    return { id, found: !!row, dismissed: !!row };
  }

  history({ since, limit = 20 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('limit must be 1–200');
    let cutoff = '';
    if (since !== undefined) {
      const match = /^(\d+(?:\.\d+)?)(s|m|h|d)$/.exec(since);
      if (!match) throw new Error('since must be a duration such as 30m, 2h, 1d');
      cutoff = new Date(this.clock().getTime() - Number(match[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]]).toISOString();
    }
    return this.db.prepare(`SELECT * FROM notifications WHERE session_id = ? AND created_at >= ?
      ORDER BY sequence DESC LIMIT ?`).all(this.sessionId, cutoff, limit).map(notificationFromRow);
  }

  snapshot() {
    const time = this.clock().toISOString();
    const { call, active } = this.transaction(() => {
      const { call_count: call } = this.db.prepare(`UPDATE sessions SET call_count = call_count + 1
        WHERE id = ? RETURNING call_count`).get(this.sessionId);
      this.db.prepare(`UPDATE notifications SET first_visible_call = ?
        WHERE session_id = ? AND dismissed_at IS NULL AND first_visible_call IS NULL`).run(call, this.sessionId);
      const active = this.db.prepare(`SELECT * FROM notifications
        WHERE session_id = ? AND dismissed_at IS NULL ORDER BY sequence`).all(this.sessionId)
        .map(row => ({ ...notificationFromRow(row), turnAge: call - row.first_visible_call }));
      return { call, active };
    });
    // JSON quoting and angle escaping prevent producer text from breaking the envelope.
    const quote = value => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
    const lines = active.map(n => `- [${n.createdAt}] [t-${n.turnAge}] [${n.id}] source=${quote(n.source)} message=${quote(n.message)}`);
    const block = `${OPEN_MARKER}\n## Notifications\n\nCurrent time: ${time}\n\n${lines.join('\n')}\n${CLOSE_MARKER}`;
    return { call, time, active, block };
  }
}

export function injectSnapshot(messages, snapshot, { position = 'tail' } = {}) {
  if (!['tail', 'before-input'].includes(position)) throw new Error('Unknown notification position');
  const clean = messages.filter(m => !(m.role === 'custom' && m.customType === CONTEXT_TYPE));
  const notification = {
    role: 'custom', customType: CONTEXT_TYPE, content: snapshot.block,
    display: false, timestamp: Date.parse(snapshot.time),
  };
  let boundary = clean.length;
  if (position === 'before-input' && ['user', 'toolResult'].includes(clean.at(-1)?.role)) {
    const role = clean.at(-1).role;
    // Current input is only the trailing input batch, not every message since the
    // last user turn: keeping older tool/assistant exchanges in the prefix matters.
    while (boundary > 0 && clean[boundary - 1].role === role) boundary--;
  }
  return [...clean.slice(0, boundary), notification, ...clean.slice(boundary)];
}
