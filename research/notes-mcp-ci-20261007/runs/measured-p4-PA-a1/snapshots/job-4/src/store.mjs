import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { textValue, tagsValue, tagValue, idValue, objectValue } from './validation.mjs';

export function openStore(path) {
  mkdirSync(dirname(path), {recursive:true});
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY,text TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tags(name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS note_tags(note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,tag TEXT REFERENCES tags(name),PRIMARY KEY(note_id,tag));`);
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const attach = (id, tags) => {
    for (const tag of tags) {
      db.prepare('INSERT OR IGNORE INTO tags VALUES(?)').run(tag);
      db.prepare('INSERT INTO note_tags VALUES(?,?)').run(id, tag);
    }
  };
  const getNote = id => {
    idValue(id);
    const row = db.prepare('SELECT * FROM notes WHERE id=?').get(id);
    if (!row) return null;
    return {id:Number(row.id), text:row.text, createdAt:row.created_at, updatedAt:row.updated_at,
      tags:db.prepare('SELECT tag FROM note_tags WHERE note_id=? ORDER BY tag').all(id).map(r => r.tag)};
  };
  const insert = (text, tags) => {
    const now = new Date().toISOString();
    const id = Number(db.prepare('INSERT INTO notes(text,created_at,updated_at) VALUES(?,?,?)').run(text, now, now).lastInsertRowid);
    attach(id, tags);
    return getNote(id);
  };
  return {
    createNote(text, tags = []) {
      text = textValue(text); tags = tagsValue(tags);
      return transaction(() => insert(text, tags));
    },
    // Shared importer uses this to commit the entire validated batch together.
    createNotes(records) {
      const prepared = records.map(r => ({text:textValue(r.text), tags:tagsValue(r.tags)}));
      return transaction(() => prepared.map(r => insert(r.text, r.tags)));
    },
    getNote,
    listNotes({q, tag, limit = 50, offset = 0} = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 to 100');
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('offset must be a nonnegative integer');
      const clauses = [], params = [];
      if (q !== undefined) {
        if (typeof q !== 'string') throw new Error('q must be a string');
        clauses.push("text LIKE ? ESCAPE '\\'");
        params.push('%' + q.replace(/[\\%_]/g, c => '\\' + c) + '%');
      }
      if (tag !== undefined) {
        clauses.push('EXISTS(SELECT 1 FROM note_tags WHERE note_id=notes.id AND tag=?)');
        params.push(tagValue(tag));
      }
      return db.prepare(`SELECT id FROM notes ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''} ORDER BY id DESC LIMIT ? OFFSET ?`)
        .all(...params, limit, offset).map(r => getNote(Number(r.id)));
    },
    updateNote(id, patch) {
      idValue(id); objectValue(patch);
      const text = Object.hasOwn(patch, 'text') ? textValue(patch.text) : undefined;
      const tags = Object.hasOwn(patch, 'tags') ? tagsValue(patch.tags) : undefined;
      return transaction(() => {
        const previous = getNote(id);
        if (!previous) return null;
        const now = new Date(Math.max(Date.now(), Date.parse(previous.updatedAt) + 1)).toISOString();
        db.prepare('UPDATE notes SET text=?, updated_at=? WHERE id=?').run(text ?? previous.text, now, id);
        if (tags !== undefined) {
          db.prepare('DELETE FROM note_tags WHERE note_id=?').run(id);
          attach(id, tags);
        }
        return getNote(id);
      });
    },
    deleteNote(id) {
      idValue(id);
      return db.prepare('DELETE FROM notes WHERE id=?').run(id).changes > 0;
    },
    listTags() {
      return db.prepare('SELECT tag AS name, COUNT(*) AS count FROM note_tags GROUP BY tag ORDER BY tag').all().map(r => ({name:r.name, count:Number(r.count)}));
    },
    close() { db.close(); }
  };
}
