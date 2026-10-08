import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
export const validateText=text=>{if(typeof text!=='string'||!text.trim()||text.trim().length>4000)throw new Error('invalid text');return text.trim();};
export const validateTags=tags=>{if(!Array.isArray(tags))throw new Error('invalid tags');return [...new Set(tags.map(t=>{if(typeof t!=='string'||!t.trim()||t.trim().length>40)throw new Error('invalid tag');return t.trim().toLowerCase();}))].sort();};
export function openStore(path){
  mkdirSync(dirname(path),{recursive:true});const db=new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY,text TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS tags(name TEXT PRIMARY KEY);CREATE TABLE IF NOT EXISTS note_tags(note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,tag TEXT REFERENCES tags(name),PRIMARY KEY(note_id,tag));`);
  const transaction=fn=>{db.exec('BEGIN');try{const out=fn();db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}};
  const getNote=id=>{const r=db.prepare('SELECT * FROM notes WHERE id=?').get(id);return r?{id:Number(r.id),text:r.text,createdAt:r.created_at,updatedAt:r.updated_at,tags:db.prepare('SELECT tag FROM note_tags WHERE note_id=? ORDER BY tag').all(id).map(r=>r.tag)}:null;};
  const putTags=(id,tags)=>{db.prepare('DELETE FROM note_tags WHERE note_id=?').run(id);for(const t of tags){db.prepare('INSERT OR IGNORE INTO tags VALUES(?)').run(t);db.prepare('INSERT INTO note_tags VALUES(?,?)').run(id,t);}};
  const create=(text,tags=[])=>{text=validateText(text);tags=validateTags(tags);return transaction(()=>{const now=new Date().toISOString();const id=Number(db.prepare('INSERT INTO notes(text,created_at,updated_at) VALUES(?,?,?)').run(text,now,now).lastInsertRowid);putTags(id,tags);return getNote(id);});};
  return {createNote:create,getNote,
    listNotes({q,tag,limit=50,offset=0}={}){if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0)throw new Error('pagination');let rows=db.prepare('SELECT id FROM notes ORDER BY id DESC').all().map(r=>getNote(r.id));if(q!==undefined)rows=rows.filter(n=>n.text.toLowerCase().includes(String(q).toLowerCase()));if(tag!==undefined)rows=rows.filter(n=>n.tags.includes(String(tag).trim().toLowerCase()));return rows.slice(offset,offset+limit);},
    updateNote(id,patch){const old=getNote(id);if(!old)return null;const text='text'in patch?validateText(patch.text):old.text,tags='tags'in patch?validateTags(patch.tags):old.tags;return transaction(()=>{const now=new Date(Math.max(Date.now(),Date.parse(old.updatedAt)+1)).toISOString();db.prepare('UPDATE notes SET text=?,updated_at=? WHERE id=?').run(text,now,id);putTags(id,tags);return getNote(id);});},
    deleteNote(id){return db.prepare('DELETE FROM notes WHERE id=?').run(id).changes>0;},
    listTags(){return db.prepare('SELECT tag AS name,COUNT(*) AS count FROM note_tags GROUP BY tag ORDER BY tag').all().map(r=>({name:r.name,count:Number(r.count)}));},
    allNotes(){return db.prepare('SELECT id FROM notes ORDER BY id DESC').all().map(r=>getNote(r.id));},
    exportNotes(){return {version:1,notes:db.prepare('SELECT id FROM notes ORDER BY id').all().map(r=>{const n=getNote(r.id);return {text:n.text,tags:n.tags};})};},
    importNotes(notes){if(!Array.isArray(notes))throw new Error('invalid notes');const clean=notes.map(n=>({text:validateText(n.text),tags:validateTags(n.tags??[])}));return clean.map(n=>create(n.text,n.tags));},close(){db.close();}};
}
