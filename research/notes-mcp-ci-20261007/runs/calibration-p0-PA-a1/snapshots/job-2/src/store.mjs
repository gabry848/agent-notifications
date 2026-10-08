// Legacy prototype. Public methods must be completed and hardened for the contract.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export function openStore(path) {
  mkdirSync(dirname(path), {recursive:true});
  const db=new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY,text TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tags(name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS note_tags(note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,tag TEXT REFERENCES tags(name),PRIMARY KEY(note_id,tag));`);
  const getNote=id=>{
    const row=db.prepare('SELECT * FROM notes WHERE id=?').get(id);
    if(!row)return null;
    return {id:Number(row.id),text:row.text,createdAt:row.created_at,updatedAt:row.updated_at,
      tags:db.prepare('SELECT tag FROM note_tags WHERE note_id=? ORDER BY tag').all(id).map(r=>r.tag)};
  };
  return {
    createNote(text,tags=[]) {
      const now=new Date().toISOString();
      const id=Number(db.prepare('INSERT INTO notes(text,created_at,updated_at) VALUES(?,?,?)').run(text,now,now).lastInsertRowid);
      for(const tag of tags){db.prepare('INSERT OR IGNORE INTO tags VALUES(?)').run(tag);db.prepare('INSERT OR IGNORE INTO note_tags VALUES(?,?)').run(id,tag);}
      return getNote(id);
    }, getNote,
    listNotes(){return db.prepare('SELECT id FROM notes ORDER BY id DESC').all().map(r=>getNote(r.id));},
    updateNote(){throw new Error('Not implemented');},
    deleteNote(id){return db.prepare('DELETE FROM notes WHERE id=?').run(id).changes>0;},
    listTags(){return db.prepare('SELECT name,(SELECT COUNT(*) FROM note_tags WHERE tag=name) AS count FROM tags ORDER BY name').all();},
    close(){db.close();}
  };
}
