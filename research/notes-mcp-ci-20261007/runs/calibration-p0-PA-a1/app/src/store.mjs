import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function validateText(text) {
  if (typeof text !== 'string') throw new Error('Text must be a string');
  text = text.trim();
  if (!text.length || text.length > 4000) throw new Error('Text must contain 1–4000 characters');
  return text;
}
export function validateTags(tags) {
  if (!Array.isArray(tags)) throw new Error('Tags must be an array');
  return [...new Set(tags.map(tag => {
    if (typeof tag !== 'string') throw new Error('Tags must be strings');
    tag = tag.trim().toLowerCase();
    if (!tag.length || tag.length > 40) throw new Error('Tags must contain 1–40 characters');
    return tag;
  }))].sort();
}
export function validateId(id) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('ID must be a positive integer');
  return id;
}
export function validateRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Note must be an object');
  return {text: validateText(record.text), tags: validateTags(record.tags === undefined ? [] : record.tags)};
}
export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), {recursive:true});
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
  const getNote = id => {
    validateId(id);
    const row = db.prepare('SELECT * FROM notes WHERE id=?').get(id);
    if (!row) return null;
    return {id:Number(row.id), text:row.text, createdAt:row.created_at, updatedAt:row.updated_at,
      tags:db.prepare('SELECT tag FROM note_tags WHERE note_id=? ORDER BY tag').all(id).map(r=>r.tag)};
  };
  const attach = (id,tags) => {
    for (const tag of tags) {
      db.prepare('INSERT OR IGNORE INTO tags VALUES(?)').run(tag);
      db.prepare('INSERT INTO note_tags VALUES(?,?)').run(id,tag);
    }
  };
  const insert = ({text,tags}) => {
    const now = new Date().toISOString();
    const id = Number(db.prepare('INSERT INTO notes(text,created_at,updated_at) VALUES(?,?,?)').run(text,now,now).lastInsertRowid);
    attach(id,tags);
    return getNote(id);
  };
  const store = {
    createNote(text,tags=[]) { const record=validateRecord({text,tags}); return transaction(()=>insert(record)); },
    getNote,
    listNotes(options={}) {
      if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Filters must be an object');
      const {q,tag,limit=50,offset=0}=options;
      if (!Number.isInteger(limit) || limit<1 || limit>100) throw new Error('Limit must be an integer from 1 to 100');
      if (!Number.isSafeInteger(offset) || offset<0) throw new Error('Offset must be a nonnegative integer');
      if (q !== undefined && typeof q !== 'string') throw new Error('Query must be a string');
      const normalizedTag=tag === undefined ? undefined : validateTags([tag])[0];
      // JS case folding provides literal Unicode substring matching, not SQL wildcard matching.
      return db.prepare('SELECT id,text FROM notes ORDER BY id DESC').all()
        .filter(r=>(q===undefined || r.text.toLowerCase().includes(q.toLowerCase())) &&
          (normalizedTag===undefined || !!db.prepare('SELECT 1 FROM note_tags WHERE note_id=? AND tag=?').get(r.id,normalizedTag)))
        .slice(offset,offset+limit).map(r=>getNote(Number(r.id)));
    },
    updateNote(id,patch) {
      validateId(id);
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Patch must be an object');
      const text=Object.hasOwn(patch,'text') ? validateText(patch.text) : undefined;
      const tags=Object.hasOwn(patch,'tags') ? validateTags(patch.tags) : undefined;
      return transaction(()=>{
        const old=getNote(id);
        if (!old) return null;
        const now=new Date(Math.max(Date.now(),Date.parse(old.updatedAt)+1)).toISOString();
        db.prepare('UPDATE notes SET text=?,updated_at=? WHERE id=?').run(text??old.text,now,id);
        if (tags!==undefined) { db.prepare('DELETE FROM note_tags WHERE note_id=?').run(id); attach(id,tags); }
        return getNote(id);
      });
    },
    deleteNote(id) { validateId(id); return db.prepare('DELETE FROM notes WHERE id=?').run(id).changes>0; },
    listTags() { return db.prepare('SELECT tag AS name,COUNT(*) AS count FROM note_tags GROUP BY tag ORDER BY tag').all().map(r=>({...r})); },
    exportNotes() { return {version:1,notes:db.prepare('SELECT id FROM notes ORDER BY id').all().map(r=>{const {text,tags}=getNote(Number(r.id));return {text,tags};})}; },
    importNotes(notes) {
      if (!Array.isArray(notes)) throw new Error('Notes must be an array');
      const records=notes.map(validateRecord);
      return transaction(()=>records.map(insert));
    },
    close() { db.close(); }
  };
  return store;
}
