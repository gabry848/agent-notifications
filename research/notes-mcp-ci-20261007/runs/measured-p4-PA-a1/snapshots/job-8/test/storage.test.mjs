import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/store.mjs';
import { importNotes, exportNotes, allNotes } from '../src/import.mjs';

function memory(t) { const s = openStore(':memory:'); t.after(() => s.close()); return s; }
test('normalize, validate, update atomically and count live tags', t => {
  const s = memory(t), n = s.createNote('  Hello  ', [' Z ', 'work', 'WORK']);
  assert.equal(n.text,'Hello'); assert.deepEqual(n.tags,['work','z']);
  for (const text of [null,7,' ','x'.repeat(4001)]) assert.throws(() => s.createNote(text));
  for (const tags of [null,'work',[''],[7],['x'.repeat(41)],['valid',null]]) {
    assert.throws(() => s.createNote('bad',tags));
    assert.throws(() => s.updateNote(n.id,{text:'changed',tags}));
  }
  assert.deepEqual(s.getNote(n.id),n);
  const updated = s.updateNote(n.id,{text:'new',tags:['only']});
  assert.equal(updated.createdAt,n.createdAt); assert.ok(updated.updatedAt > n.updatedAt);
  assert.deepEqual(updated.tags,['only']);
  assert.ok(s.updateNote(n.id,{}).updatedAt > updated.updatedAt);
  assert.deepEqual(s.listTags(),[{name:'only',count:1}]);
  assert.equal(s.getNote(999),null); assert.equal(s.updateNote(999,{}),null); assert.equal(s.deleteNote(999),false);
  assert.equal(s.deleteNote(n.id),true); assert.deepEqual(s.listTags(),[]);
});
test('literal, Unicode case-insensitive search and exact normalized filters', t => {
  const s = memory(t);
  const a = s.createNote('ÉCOLE 100% _ \\',["Work"]), b = s.createNote('ecole ordinary',['home']), c = s.createNote('latest',['work']);
  for (const q of ['%','_','\\','école']) assert.deepEqual(s.listNotes({q}).map(n=>n.id),[a.id]);
  assert.deepEqual(s.listNotes({tag:' WORK ',limit:1,offset:1}).map(n=>n.id),[a.id]);
  assert.deepEqual(s.listNotes().map(n=>n.id),[c.id,b.id,a.id]);
  for (const args of [{limit:0},{limit:101},{limit:1.5},{offset:-1},{offset:'0'},{q:null},{tag:''}]) assert.throws(()=>s.listNotes(args));
});
test('import validates all fields before writing and export handles more than 100 notes', t => {
  const s = memory(t); s.createNote('existing');
  for (const invalid of [{text:' '},{text:'bad',tags:[null]},{text:'bad',tags:null},{text:'bad',tags:['x'.repeat(41)]},null]) {
    assert.throws(()=>importNotes(s,[{text:'valid',tags:['one']},invalid]));
    assert.equal(s.listNotes().length,1); assert.deepEqual(s.listTags(),[]);
  }
  const imported = importNotes(s,Array.from({length:105},(_,i)=>({text:`Note ${i}`,tags:['B','a']})));
  assert.equal(imported.length,105); assert.equal(allNotes(s).length,106);
  const exported = exportNotes(s); assert.equal(exported.version,1);
  assert.deepEqual(exported.notes[0],{text:'existing',tags:[]});
  assert.deepEqual(exported.notes.at(-1),{text:'Note 104',tags:['a','b']});
});
test('nested database persistence and foreign key deletion', t => {
  const dir = mkdtempSync(join(process.cwd(),'.test-store-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path = join(dir,'nested','notes.sqlite'); let s = openStore(path);
  const n = s.createNote('persist',['unique']); s.close(); s = openStore(path);
  assert.deepEqual(s.getNote(n.id),n); s.deleteNote(n.id); s.close();
  const db = new DatabaseSync(path); t.after(()=>db.close());
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM note_tags').get().n,0);
});
