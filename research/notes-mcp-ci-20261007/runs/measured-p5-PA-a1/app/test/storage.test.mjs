import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openStore} from '../src/store.mjs';
import {importNotes,exportNotes,allNotes} from '../src/import.mjs';

test('normalization, literal/Unicode search, ordering and validation',t=>{
  const s=openStore(':memory:'); t.after(()=>s.close());
  const n=s.createNote('  ÉCOLE 100%_ <script>  ',[' Work ','work','Alpha']);
  assert.deepEqual(n.tags,['alpha','work']);
  assert.equal(n.text,'ÉCOLE 100%_ <script>');
  assert.match(n.createdAt,/^\d{4}-/);
  s.createNote('100 percent',['worker']);
  for (const q of ['%','_','école']) assert.deepEqual(s.listNotes({q}).map(n=>n.id),[n.id]);
  assert.deepEqual(s.listNotes({tag:' WORK '}).map(n=>n.id),[n.id]);
  assert.equal(s.listNotes({limit:1,offset:1})[0].id,n.id);
  for (const text of ['', '   ',null,42,'a'.repeat(4001)]) assert.throws(()=>s.createNote(text));
  for (const tags of [null,{},[''],[42],['a'.repeat(41)]]) assert.throws(()=>s.createNote('invalid',tags));
  for (const options of [{limit:0},{limit:101},{limit:1.5},{offset:-1},{offset:'0'},{q:12}]) assert.throws(()=>s.listNotes(options));
  assert.equal(s.listNotes().length,2);
});

test('updates and mixed invalid imports are atomic; foreign keys cascade; persistence',t=>{
  const dir=mkdtempSync(join(tmpdir(),'quick-store-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'nested','notes.sqlite');
  let s=openStore(path);
  const n=s.createNote('original',['only']);
  assert.throws(()=>s.updateNote(n.id,{text:'changed',tags:['fine',null]}));
  assert.deepEqual(s.getNote(n.id),n);
  for (const invalid of [{text:'bad',tags:[null]},{text:42,tags:[]},{text:'bad',tags:null}]) {
    assert.throws(()=>importNotes(s,[{text:'valid',tags:['ok']},invalid]));
    assert.equal(s.listNotes().length,1);
  }
  const updated=s.updateNote(n.id,{text:' new ',tags:['B','a']});
  assert.equal(updated.createdAt,n.createdAt);
  assert.ok(updated.updatedAt>n.updatedAt);
  assert.deepEqual(updated.tags,['a','b']);
  assert.deepEqual(s.listTags(),[{name:'a',count:1},{name:'b',count:1}]);
  assert.ok(s.updateNote(n.id,{}).updatedAt>updated.updatedAt);
  assert.equal(s.getNote(999),null); assert.equal(s.updateNote(999,{}),null); assert.equal(s.deleteNote(999),false);
  s.close(); s=openStore(path);
  assert.equal(s.getNote(n.id).text,'new');
  assert.equal(s.deleteNote(n.id),true); assert.deepEqual(s.listTags(),[]); s.close();
  const db=new DatabaseSync(path);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM note_tags').get().n,0); db.close();
});

test('bulk import, full resource and export beyond one page',t=>{
  const s=openStore(':memory:');t.after(()=>s.close());
  const created=importNotes(s,Array.from({length:125},(_,i)=>({text:`note ${i}`,tags:[' Bulk ']})));
  assert.equal(created.length,125);
  assert.equal(allNotes(s)[0].text,'note 124');
  const exported=exportNotes(s);
  assert.equal(exported.version,1); assert.equal(exported.notes.length,125);
  assert.deepEqual(exported.notes[0],{text:'note 0',tags:['bulk']});
  assert.deepEqual(s.listTags(),[{name:'bulk',count:125}]);
});
