import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalizeText, normalizeTags, normalizeTag, validId, object } from './validation.mjs';

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), {recursive:true});
  const db = new DatabaseSync(path);
  // SQLite's built-in lower() is ASCII-only; use JS for Unicode casing.
  db.function('casefold',{deterministic:true},value=>value.toLowerCase());
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY,text TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tags(name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS note_tags(note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,tag TEXT REFERENCES tags(name),PRIMARY KEY(note_id,tag));`);
  let depth = 0;
  const transaction = fn => {
    if (depth) return fn();
    db.exec('BEGIN IMMEDIATE'); depth++;
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { depth--; }
  };
  const getNote = id => {
    validId(id);
    const row = db.prepare('SELECT * FROM notes WHERE id=?').get(id);
    if (!row) return null;
    return {id:Number(row.id),text:row.text,createdAt:row.created_at,updatedAt:row.updated_at,
      tags:db.prepare('SELECT tag FROM note_tags WHERE note_id=? ORDER BY tag').all(id).map(r=>r.tag)};
  };
  const attach = (id,tags) => {
    for (const tag of tags) {
      db.prepare('INSERT OR IGNORE INTO tags(name) VALUES(?)').run(tag);
      db.prepare('INSERT INTO note_tags(note_id,tag) VALUES(?,?)').run(id,tag);
    }
  };
  return {
    transaction,
    createNote(text,tags=[]) {
      text = normalizeText(text); tags = normalizeTags(tags);
      return transaction(() => {
        const now = new Date().toISOString();
        const id = Number(db.prepare('INSERT INTO notes(text,created_at,updated_at) VALUES(?,?,?)').run(text,now,now).lastInsertRowid);
        attach(id,tags); return getNote(id);
      });
    },
    getNote,
    listNotes(options={}) {
      object(options);
      const {q,tag,limit=50,offset=0} = options;
      if (!Number.isInteger(limit) || limit<1 || limit>100) throw new Error('limit must be an integer from 1 to 100');
      if (!Number.isSafeInteger(offset) || offset<0) throw new Error('offset must be a nonnegative integer');
      if (q !== undefined && typeof q !== 'string') throw new Error('q must be a string');
      const filters = [], params = [];
      if (q !== undefined) { filters.push('instr(casefold(text),casefold(?))>0'); params.push(q); }
      if (tag !== undefined) { filters.push('EXISTS(SELECT 1 FROM note_tags WHERE note_id=notes.id AND tag=?)'); params.push(normalizeTag(tag)); }
      return db.prepare(`SELECT id FROM notes ${filters.length?'WHERE '+filters.join(' AND '):''} ORDER BY id DESC LIMIT ? OFFSET ?`)
        .all(...params,limit,offset).map(r=>getNote(Number(r.id)));
    },
    updateNote(id,patch) {
      validId(id); object(patch);
      const text = Object.hasOwn(patch,'text') ? normalizeText(patch.text) : undefined;
      const tags = Object.hasOwn(patch,'tags') ? normalizeTags(patch.tags) : undefined;
      return transaction(() => {
        const old = getNote(id); if (!old) return null;
        const now = new Date(Math.max(Date.now(),Date.parse(old.updatedAt)+1)).toISOString();
        db.prepare('UPDATE notes SET text=?,updated_at=? WHERE id=?').run(text??old.text,now,id);
        if (tags !== undefined) { db.prepare('DELETE FROM note_tags WHERE note_id=?').run(id); attach(id,tags); }
        return getNote(id);
      });
    },
    deleteNote(id) { validId(id); return db.prepare('DELETE FROM notes WHERE id=?').run(id).changes>0; },
    listTags() { return db.prepare('SELECT tag AS name,COUNT(*) AS count FROM note_tags GROUP BY tag ORDER BY tag').all().map(r=>({name:r.name,count:Number(r.count)})); },
    close() { db.close(); }
  };
}
