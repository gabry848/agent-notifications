import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function validateText(text) {
  if (typeof text !== 'string' || !text.trim() || text.trim().length > 4000)
    throw new Error('Text must contain 1–4000 characters');
  return text.trim();
}
export function validateTags(tags) {
  if (!Array.isArray(tags)) throw new Error('Tags must be an array');
  return [...new Set(tags.map(tag => {
    if (typeof tag !== 'string' || !tag.trim() || tag.trim().length > 40)
      throw new Error('Each tag must contain 1–40 characters');
    return tag.trim().toLowerCase();
  }))].sort();
}
export function validateId(id) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('ID must be a positive integer');
  return id;
}
export function openStore(path) {
  mkdirSync(dirname(path), {recursive:true});
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY,text TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tags(name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS note_tags(note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,tag TEXT REFERENCES tags(name),PRIMARY KEY(note_id,tag));`);
  const transaction = fn => {
    db.exec('BEGIN');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const attach = (id, tags) => {
    for (const tag of tags) {
      db.prepare('INSERT OR IGNORE INTO tags VALUES(?)').run(tag);
      db.prepare('INSERT INTO note_tags VALUES(?,?)').run(id, tag);
    }
  };
  const getNote = id => {
    validateId(id);
    const row = db.prepare('SELECT * FROM notes WHERE id=?').get(id);
    if (!row) return null;
    return {id:Number(row.id), text:row.text, createdAt:row.created_at, updatedAt:row.updated_at,
      tags:db.prepare('SELECT tag FROM note_tags WHERE note_id=? ORDER BY tag').all(id).map(r => r.tag)};
  };
  return {
    createNote(text, tags=[]) {
      text = validateText(text); tags = validateTags(tags);
      return transaction(() => {
        const now = new Date().toISOString();
        const id = Number(db.prepare('INSERT INTO notes(text,created_at,updated_at) VALUES(?,?,?)').run(text,now,now).lastInsertRowid);
        attach(id, tags);
        return getNote(id);
      });
    },
    getNote,
    listNotes({q,tag,limit=50,offset=0}={}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Limit must be an integer from 1 to 100');
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Offset must be a nonnegative integer');
      if (q !== undefined && typeof q !== 'string') throw new Error('Query must be a string');
      if (tag !== undefined) tag = validateTags([tag])[0];
      const clauses = [], args = [];
      if (q !== undefined) { clauses.push('instr(lower(text),lower(?)) > 0'); args.push(q); }
      if (tag !== undefined) { clauses.push('EXISTS(SELECT 1 FROM note_tags WHERE note_id=notes.id AND tag=?)'); args.push(tag); }
      return db.prepare(`SELECT id FROM notes ${clauses.length ? 'WHERE '+clauses.join(' AND ') : ''} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args,limit,offset).map(r => getNote(Number(r.id)));
    },
    updateNote(id, patch) {
      validateId(id);
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Patch must be an object');
      const text = Object.hasOwn(patch,'text') ? validateText(patch.text) : undefined;
      const tags = Object.hasOwn(patch,'tags') ? validateTags(patch.tags) : undefined;
      const old = getNote(id);
      if (!old) return null;
      return transaction(() => {
        const now = new Date(Math.max(Date.now(), Date.parse(old.updatedAt)+1)).toISOString();
        db.prepare('UPDATE notes SET text=?,updated_at=? WHERE id=?').run(text ?? old.text,now,id);
        if (tags !== undefined) { db.prepare('DELETE FROM note_tags WHERE note_id=?').run(id); attach(id,tags); }
        return getNote(id);
      });
    },
    deleteNote(id) { validateId(id); return db.prepare('DELETE FROM notes WHERE id=?').run(id).changes > 0; },
    listTags() { return db.prepare('SELECT tag AS name, COUNT(*) AS count FROM note_tags GROUP BY tag ORDER BY tag').all().map(r => ({name:r.name,count:Number(r.count)})); },
    close() { db.close(); }
  };
}
