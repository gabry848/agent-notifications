import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function normalizeText(text) {
  if (typeof text !== 'string' || !text.trim() || text.trim().length > 4000)
    throw new Error('Text must contain 1–4000 characters');
  return text.trim();
}
export function normalizeTags(tags = []) {
  if (!Array.isArray(tags)) throw new Error('Tags must be an array');
  return [...new Set(tags.map(tag => {
    if (typeof tag !== 'string' || !tag.trim() || tag.trim().length > 40)
      throw new Error('Tags must contain 1–40 characters');
    return tag.trim().toLowerCase();
  }))].sort();
}
export function validId(id) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('ID must be a positive integer');
  return id;
}
export function openStore(path) {
  mkdirSync(dirname(path), {recursive:true});
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY AUTOINCREMENT,text TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tags(name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS note_tags(note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,tag TEXT REFERENCES tags(name),PRIMARY KEY(note_id,tag));`);
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const getNote = id => {
    validId(id);
    const row = db.prepare('SELECT * FROM notes WHERE id=?').get(id);
    if (!row) return null;
    return {id:Number(row.id), text:row.text,
      tags:db.prepare('SELECT tag FROM note_tags WHERE note_id=? ORDER BY tag').all(id).map(r=>r.tag),
      createdAt:row.created_at, updatedAt:row.updated_at};
  };
  const attach = (id, tags) => {
    for (const tag of tags) {
      db.prepare('INSERT OR IGNORE INTO tags VALUES(?)').run(tag);
      db.prepare('INSERT INTO note_tags VALUES(?,?)').run(id,tag);
    }
  };
  const createNote = (text, tags=[]) => {
    text=normalizeText(text); tags=normalizeTags(tags);
    return transaction(() => {
      const now=new Date().toISOString();
      const id=Number(db.prepare('INSERT INTO notes(text,created_at,updated_at) VALUES(?,?,?)').run(text,now,now).lastInsertRowid);
      attach(id,tags); return getNote(id);
    });
  };
  return {
    createNote, getNote,
    listNotes({q,tag,limit=50,offset=0}={}) {
      if (!Number.isInteger(limit) || limit<1 || limit>100 || !Number.isSafeInteger(offset) || offset<0)
        throw new Error('Invalid limit or offset');
      if (q !== undefined && typeof q !== 'string') throw new Error('Query must be a string');
      const clauses=[], params=[];
      // Filtering in JavaScript gives literal, Unicode-aware case-insensitive matching.
      if (tag !== undefined) { tag=normalizeTags([tag])[0]; clauses.push('EXISTS(SELECT 1 FROM note_tags WHERE note_id=notes.id AND tag=?)'); params.push(tag); }
      const rows=db.prepare(`SELECT id,text FROM notes ${clauses.length?'WHERE '+clauses.join(' AND '):''} ORDER BY id DESC`).all(...params);
      return rows.filter(r=>q===undefined || r.text.toLowerCase().includes(q.toLowerCase())).slice(offset,offset+limit).map(r=>getNote(Number(r.id)));
    },
    updateNote(id, patch) {
      validId(id);
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Patch must be an object');
      const old=getNote(id); if (!old) return null;
      const text=Object.hasOwn(patch,'text')?normalizeText(patch.text):old.text;
      const tags=Object.hasOwn(patch,'tags')?normalizeTags(patch.tags):old.tags;
      return transaction(() => {
        const now=new Date(Math.max(Date.now(),Date.parse(old.updatedAt)+1)).toISOString();
        db.prepare('UPDATE notes SET text=?,updated_at=? WHERE id=?').run(text,now,id);
        db.prepare('DELETE FROM note_tags WHERE note_id=?').run(id); attach(id,tags);
        return getNote(id);
      });
    },
    deleteNote(id) { validId(id); return db.prepare('DELETE FROM notes WHERE id=?').run(id).changes>0; },
    listTags() { return db.prepare('SELECT tag AS name,COUNT(*) AS count FROM note_tags GROUP BY tag ORDER BY tag').all().map(r=>({...r})); },
    close() { db.close(); }
  };
}
