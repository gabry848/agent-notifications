import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/store.mjs';
import { importNotes, exportNotes, allNotes } from '../src/import.mjs';

test('normalization, atomic mutations, literal filters, pagination, tag counts', () => {
  const s = openStore(':memory:');
  try {
    const n = s.createNote('  Hello %_ World  ',[' Work ','work','B']);
    assert.equal(n.text,'Hello %_ World'); assert.deepEqual(n.tags,['b','work']);
    for (const text of [null,42,'','  ','a'.repeat(4001)]) assert.throws(() => s.createNote(text));
    for (const tags of [null,'tag',[''],[42],['x'.repeat(41)]]) {
      assert.throws(() => s.createNote('bad',tags));
      assert.throws(() => s.updateNote(n.id,{text:'changed',tags}));
      assert.deepEqual(s.getNote(n.id),n);
      assert.throws(() => importNotes(s,[{text:'valid'},{text:'later invalid',tags}]));
      assert.equal(s.listNotes().length,1);
    }
    assert.throws(() => importNotes(s,[{text:'valid'},{text:' '} ]));
    const other = s.createNote('hello world',['work']);
    assert.deepEqual(s.listNotes({q:'%_'}),[n]);
    assert.equal(s.listNotes({q:'HELLO',tag:' WORK '}).length,2);
    assert.deepEqual(s.listNotes({limit:1,offset:1}),[n]);
    for (const options of [{limit:0},{limit:101},{limit:1.5},{offset:-1},{offset:'0'}]) assert.throws(() => s.listNotes(options));
    const updated = s.updateNote(n.id,{tags:['NEW']});
    assert.equal(updated.createdAt,n.createdAt); assert.ok(updated.updatedAt > n.updatedAt);
    assert.deepEqual(updated.tags,['new']);
    assert.deepEqual(s.listTags(),[{name:'new',count:1},{name:'work',count:1}]);
    assert.equal(s.deleteNote(other.id),true); assert.equal(s.deleteNote(other.id),false);
    assert.equal(s.getNote(other.id),null); assert.equal(s.updateNote(other.id,{}),null);
    assert.deepEqual(s.listTags(),[{name:'new',count:1}]);
  } finally { s.close(); }
});

test('persistence, foreign-key cascade, full export and rollback', () => {
  const dir = mkdtempSync(join(process.cwd(),'.test-storage-'));
  const path = join(dir,'nested','notes.sqlite');
  let s = openStore(path);
  try {
    importNotes(s,Array.from({length:125},(_,i) => ({text:`note ${i}`,tags:['all']})));
    assert.equal(allNotes(s).length,125);
    const exported = exportNotes(s);
    assert.equal(exported.version,1); assert.equal(exported.notes[0].text,'note 0');
    assert.equal(exported.notes[124].text,'note 124');
    assert.throws(() => s.transaction(() => { s.createNote('rollback'); throw new Error('abort'); }));
    assert.equal(allNotes(s).length,125);
    s.deleteNote(1); s.close(); s = openStore(path);
    assert.equal(allNotes(s).length,124); assert.equal(s.getNote(1),null);
    const db = new DatabaseSync(path);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM note_tags WHERE note_id=1').get().n,0);
    db.close();
  } finally { s.close(); rmSync(dir,{recursive:true,force:true}); }
});
