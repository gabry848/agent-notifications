import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function normalizeText(text) {
  if (typeof text !== 'string' || !text.trim() || text.trim().length > 4000)
    throw new Error('text must be a string containing 1–4000 characters');
  return text.trim();
}
export function normalizeTags(tags) {
  if (!Array.isArray(tags)) throw new Error('tags must be an array');
  return [...new Set(tags.map(tag => {
    if (typeof tag !== 'string' || !tag.trim() || tag.trim().length > 40)
      throw new Error('tags must be nonempty strings of at most 40 characters');
    return tag.trim().toLowerCase();
  }))].sort();
}
function validId(id) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('id must be a positive integer');
}
export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), {recursive:true});
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY,text TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tags(name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS note_tags(note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,tag TEXT REFERENCES tags(name),PRIMARY KEY(note_id,tag));`);
  const transaction = fn => {
    db.exec('SAVEPOINT write_notes');
    try { const result = fn(); db.exec('RELEASE write_notes'); return result; }
    catch (error) { db.exec('ROLLBACK TO write_notes; RELEASE write_notes'); throw error; }
  };
  const getNote = id => {
    validId(id);
    const row = db.prepare('SELECT * FROM notes WHERE id=?').get(id);
    return row ? {id:Number(row.id),text:row.text,createdAt:row.created_at,updatedAt:row.updated_at,
      tags:db.prepare('SELECT tag FROM note_tags WHERE note_id=? ORDER BY tag').all(id).map(r=>r.tag)} : null;
  };
  const attach = (id,tags) => {
    for (const tag of tags) {
      db.prepare('INSERT OR IGNORE INTO tags VALUES(?)').run(tag);
      db.prepare('INSERT INTO note_tags VALUES(?,?)').run(id,tag);
    }
  };
  return {
    transaction,
    createNote(text,tags=[]) {
      text=normalizeText(text); tags=normalizeTags(tags);
      return transaction(() => {
        const now=new Date().toISOString();
        const id=Number(db.prepare('INSERT INTO notes(text,created_at,updated_at) VALUES(?,?,?)').run(text,now,now).lastInsertRowid);
        attach(id,tags); return getNote(id);
      });
    },
    getNote,
    listNotes({q,tag,limit=50,offset=0}={}) {
      if (!Number.isInteger(limit) || limit<1 || limit>100) throw new Error('limit must be an integer from 1 to 100');
      if (!Number.isSafeInteger(offset) || offset<0) throw new Error('offset must be a nonnegative integer');
      if (q !== undefined && typeof q !== 'string') throw new Error('q must be a string');
      if (tag !== undefined) tag=normalizeTags([tag])[0];
      // JavaScript case folding also handles non-ASCII text. No SQL wildcard interpretation.
      let rows=db.prepare('SELECT id,text FROM notes ORDER BY id DESC').all();
      if (q !== undefined) rows=rows.filter(r=>r.text.toLowerCase().includes(q.toLowerCase()));
      if (tag !== undefined) rows=rows.filter(r=>db.prepare('SELECT 1 FROM note_tags WHERE note_id=? AND tag=?').get(r.id,tag));
      return rows.slice(offset,offset+limit).map(r=>getNote(Number(r.id)));
    },
    updateNote(id,patch) {
      validId(id);
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('patch must be an object');
      const text=Object.hasOwn(patch,'text') ? normalizeText(patch.text) : undefined;
      const tags=Object.hasOwn(patch,'tags') ? normalizeTags(patch.tags) : undefined;
      return transaction(() => {
        const old=getNote(id); if (!old) return null;
        const now=new Date(Math.max(Date.now(),Date.parse(old.updatedAt)+1)).toISOString();
        db.prepare('UPDATE notes SET text=?,updated_at=? WHERE id=?').run(text??old.text,now,id);
        if (tags !== undefined) { db.prepare('DELETE FROM note_tags WHERE note_id=?').run(id); attach(id,tags); }
        return getNote(id);
      });
    },
    deleteNote(id) { validId(id); return db.prepare('DELETE FROM notes WHERE id=?').run(id).changes>0; },
    listTags() { return db.prepare('SELECT tag AS name,COUNT(*) AS count FROM note_tags GROUP BY tag ORDER BY tag').all().map(r=>({...r})); },
    close() { db.close(); }
  };
}
