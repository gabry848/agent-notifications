import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/store.mjs';
import { importNotes, exportNotes, allNotes } from '../src/import.mjs';

test('normalization, literal filters, atomic updates and cascade', () => {
  const store = openStore(':memory:');
  try {
    const first = store.createNote('  Hello %_  ',[' Work ','work','Z']);
    assert.equal(first.text,'Hello %_');
    assert.deepEqual(first.tags,['work','z']);
    const second = store.createNote('HELLO world',['work']);
    assert.deepEqual(store.listNotes({q:'%_'}),[first]);
    assert.equal(store.listNotes({q:'hello',tag:' WORK ',limit:1,offset:1})[0].id,first.id);
    assert.deepEqual(store.listTags(),[{name:'work',count:2},{name:'z',count:1}]);
    assert.throws(() => store.updateNote(first.id,{text:'changed',tags:['ok','']}));
    assert.deepEqual(store.getNote(first.id),first);
    const updated = store.updateNote(first.id,{text:'changed',tags:['new']});
    assert.equal(updated.createdAt,first.createdAt);
    assert.ok(updated.updatedAt > first.updatedAt);
    assert.deepEqual(updated.tags,['new']);
    assert.ok(store.updateNote(first.id,{}).updatedAt > updated.updatedAt);
    assert.equal(store.updateNote(999,{}),null);
    assert.equal(store.getNote(999),null);
    assert.equal(store.deleteNote(second.id),true);
    assert.equal(store.deleteNote(second.id),false);
    assert.deepEqual(store.listTags(),[{name:'new',count:1}]);
  } finally { store.close(); }
});

test('all invalid fields fail without mutation, including later imported tags', () => {
  const store = openStore(':memory:');
  try {
    store.createNote('existing');
    const before = store.listNotes();
    for (const text of ['', ' ', 7, null, 'x'.repeat(4001)]) assert.throws(() => store.createNote(text));
    for (const tags of [null, 'tag', [null], [''], ['x'.repeat(41)]]) {
      assert.throws(() => store.createNote('valid',tags));
      assert.throws(() => importNotes(store,[{text:'valid',tags:['good']},{text:'invalid',tags}]));
    }
    assert.throws(() => importNotes(store,[{text:'valid'},{text:' '} ]));
    assert.throws(() => importNotes(store,{}));
    assert.deepEqual(store.listNotes(),before);
    for (const limit of [0,101,1.5,'1']) assert.throws(() => store.listNotes({limit}));
    for (const offset of [-1,0.5,'1']) assert.throws(() => store.listNotes({offset}));
    assert.throws(() => store.getNote(0));
    assert.throws(() => store.listNotes({tag:null}));
    const imported = importNotes(store,[{text:' one ',tags:['T']},{text:'two'}]);
    assert.deepEqual(imported.map(n => n.text),['one','two']);
  } finally { store.close(); }
});

test('persistent SQLite, foreign-key deletion, and complete exports beyond page size', () => {
  const dir = mkdtempSync(join(tmpdir(),'quick-notes-store-'));
  const path = join(dir,'nested','notes.sqlite');
  let store;
  try {
    store = openStore(path);
    const note = store.createNote('persist',['only']);
    store.close(); store = openStore(path);
    assert.deepEqual(store.getNote(note.id),note);
    store.deleteNote(note.id);
    const inspect = new DatabaseSync(path);
    assert.equal(inspect.prepare('SELECT COUNT(*) AS n FROM note_tags').get().n,0);
    inspect.close();
    for (let i=0;i<121;i++) store.createNote('note '+i);
    assert.equal(allNotes(store).length,121);
    const exported = exportNotes(store);
    assert.equal(exported.version,1);
    assert.deepEqual(exported.notes[0],{text:'note 0',tags:[]});
    assert.equal(exported.notes.at(-1).text,'note 120');
  } finally { store?.close(); rmSync(dir,{recursive:true,force:true}); }
});
