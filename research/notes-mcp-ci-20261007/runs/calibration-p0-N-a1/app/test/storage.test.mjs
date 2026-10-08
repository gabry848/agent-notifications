import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/store.mjs';
import { importNotes, exportNotes, allNotes } from '../src/import.mjs';

test('normalization, literal search, pagination and atomic mutations', () => {
  const s=openStore(':memory:');
  try {
    const n=s.createNote('  Hello 50%_ <x>  ',[' Work ','work','HOME']);
    assert.deepEqual(n.tags,['home','work']);
    assert.equal(n.text,'Hello 50%_ <x>');
    s.createNote('hello other',['work']);
    assert.deepEqual(s.listNotes({q:'50%_'}).map(x=>x.id),[n.id]);
    assert.equal(s.listNotes({q:'HELLO',tag:' WORK '}).length,2);
    const unicode=s.createNote('CAFÉ 📝',['unicode']);
    assert.equal(s.listNotes({q:'café'})[0].id,unicode.id);
    s.deleteNote(unicode.id);
    assert.equal(s.listNotes({limit:1,offset:1})[0].id,n.id);
    for (const text of ['',null,4,'x'.repeat(4001)]) assert.throws(()=>s.createNote(text));
    for (const tags of [null,'work',[''],[2],['x'.repeat(41)]]) {
      assert.throws(()=>s.createNote('bad',tags));
      assert.throws(()=>s.updateNote(n.id,{text:'changed',tags}));
      assert.deepEqual(s.getNote(n.id),n);
    }
    for (const options of [{limit:0},{limit:101},{limit:1.5},{offset:-1},{q:2}]) assert.throws(()=>s.listNotes(options));
    const updated=s.updateNote(n.id,{tags:['new']});
    assert.equal(updated.createdAt,n.createdAt);
    assert.ok(updated.updatedAt>n.updatedAt);
    assert.deepEqual(updated.tags,['new']);
    assert.ok(s.updateNote(n.id,{}).updatedAt>updated.updatedAt);
    assert.equal(s.updateNote(999,{}),null);
    assert.equal(s.getNote(999),null);
    assert.equal(s.deleteNote(999),false);
    assert.equal(s.deleteNote(n.id),true);
    assert.deepEqual(s.listTags(),[{name:'work',count:1}]);
  } finally {s.close();}
});

test('shared import validates every field before writing, and exports all records', () => {
  const s=openStore(':memory:');
  try {
    for (const record of [{text:''},{text:'bad',tags:['ok',null]},{text:'bad',tags:null}]) {
      assert.throws(()=>importNotes(s,[{text:'valid',tags:['ok']},record]));
      assert.deepEqual(s.listNotes(),[]);
    }
    const notes=importNotes(s,Array.from({length:125},(_,i)=>({text:'note '+i,tags:[' TEST ']})));
    assert.equal(notes.length,125);
    assert.equal(allNotes(s).length,125);
    assert.equal(exportNotes(s).notes[0].text,'note 0');
    assert.equal(exportNotes(s).notes.at(-1).text,'note 124');
    assert.throws(()=>s.transaction(()=>{s.createNote('rolled back');throw Error('abort');}));
    assert.equal(allNotes(s).length,125);
  } finally {s.close();}
});

test('disk persistence, nested directory creation and foreign key cascade', () => {
  const dir=mkdtempSync('test/.storage-');
  const path=join(dir,'nested','notes.sqlite');
  try {
    let s=openStore(path);const n=s.createNote('persistent',['unique']);s.close();
    s=openStore(path);assert.equal(s.getNote(n.id).text,'persistent');
    s.deleteNote(n.id);s.close();
    const db=new DatabaseSync(path);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM note_tags').get().n,0);
    db.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
});
