import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {openStore} from '../src/store.mjs';
import {importNotes,exportNotes,allNotes} from '../src/import.mjs';

test('normalization, literal filters, pagination and atomic updates',()=>{
  const s=openStore(':memory:');
  try {
    const first=s.createNote('  50%_ DONE  ',[' Work ','work','A']);
    assert.equal(first.text,'50%_ DONE');assert.deepEqual(first.tags,['a','work']);
    const second=s.createNote('other',['work']);
    assert.deepEqual(s.listNotes({q:'%_ doNe'}),[first]);
    assert.deepEqual(s.listNotes({tag:' WORK ',limit:1,offset:1}),[first]);
    assert.deepEqual(s.listNotes().map(n=>n.id),[second.id,first.id]);
    const updated=s.updateNote(first.id,{text:'new',tags:['Next']});
    assert.equal(updated.createdAt,first.createdAt);assert.ok(updated.updatedAt>first.updatedAt);
    assert.deepEqual(updated.tags,['next']);
    assert.throws(()=>s.updateNote(first.id,{text:'changed',tags:['valid',null]}));
    assert.deepEqual(s.getNote(first.id),updated);
    assert.throws(()=>s.createNote('bad',['valid','']));
    assert.equal(s.listNotes().length,2);
    for (const text of [null,3,'','  ','x'.repeat(4001)]) assert.throws(()=>s.createNote(text));
    for (const tags of [null,{},'tag',['x'.repeat(41)],[4],new Array(1)]) assert.throws(()=>s.createNote('ok',tags));
    for (const options of [{limit:0},{limit:101},{limit:1.5},{offset:-1},{offset:1.5},{q:4},{tag:''}]) assert.throws(()=>s.listNotes(options));
    assert.equal(s.getNote(999),null);assert.equal(s.updateNote(999,{}),null);assert.equal(s.deleteNote(999),false);
    assert.equal(s.deleteNote(first.id),true);
    assert.deepEqual(s.listTags(),[{name:'work',count:1}]);
    assert.ok(s.updateNote(second.id,{}).updatedAt>second.updatedAt);
    const unicode=s.createNote('CAFÉ Ελληνικά');
    assert.deepEqual(s.listNotes({q:'café ελληνικά'}),[unicode]);
  } finally {s.close();}
});

test('shared importer validates every field before writes, including later tags',()=>{
  const s=openStore(':memory:');
  try {
    for (const invalid of [{text:' '},{text:'x',tags:null},{text:'x',tags:['']},{text:'x',tags:[false]}]) {
      assert.throws(()=>importNotes(s,[{text:'valid',tags:['good']},invalid]));
      assert.deepEqual(s.listNotes(),[]);assert.deepEqual(s.listTags(),[]);
    }
    const notes=importNotes(s,[{text:' oldest ',tags:['B','b']},{text:'newest'}]);
    assert.deepEqual(exportNotes(s),{version:1,notes:[{text:'oldest',tags:['b']},{text:'newest',tags:[]}]});
    assert.deepEqual(allNotes(s),notes.toReversed());
    assert.throws(()=>s.transaction(()=>{s.createNote('rolled back');throw new Error('abort');}));
    assert.equal(s.listNotes().length,2);
  } finally {s.close();}
});

test('persistence, parent creation and complete exports beyond 100 records',()=>{
  const dir=mkdtempSync(join(process.cwd(),'test/.db-'));
  const path=join(dir,'nested','notes.sqlite');
  let s=openStore(path);
  try {
    for (let i=0;i<125;i++) s.createNote(`note ${i}`,['count']);
    s.close();s=openStore(path);
    assert.equal(allNotes(s).length,125);
    assert.equal(exportNotes(s).notes[0].text,'note 0');
    assert.deepEqual(s.listTags(),[{name:'count',count:125}]);
  } finally {s.close();rmSync(dir,{recursive:true,force:true});}
});
