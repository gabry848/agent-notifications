import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/store.mjs';
import { importNotes, exportNotes, allNotes } from '../src/import.mjs';
import { fixture } from './helpers.mjs';

test('normalization, literal filtering, pagination, updates and cascades', t => {
  const path = fixture(t), store = openStore(path);
  t.after(() => store.close());
  const a = store.createNote('  Hello %_ world  ', [' Work ', 'work', 'HOME']);
  assert.deepEqual(a.tags, ['home', 'work']);
  assert.equal(a.text, 'Hello %_ world');
  assert.ok(!Number.isNaN(Date.parse(a.createdAt)));
  const b = store.createNote('hello world', ['work']);
  assert.deepEqual(store.listNotes({ q: '%_' }).map(n => n.id), [a.id]);
  assert.deepEqual(store.listNotes({ q: 'HELLO', tag: ' WORK ', limit: 1, offset: 1 }), [a]);
  const updated = store.updateNote(a.id, { text: ' replaced ', tags: ['other'] });
  assert.equal(updated.createdAt, a.createdAt);
  assert.ok(updated.updatedAt > a.updatedAt);
  assert.deepEqual(updated.tags, ['other']);
  assert.equal(store.updateNote(a.id, {}).text, 'replaced');
  assert.deepEqual(store.listTags(), [{ name: 'other', count: 1 }, { name: 'work', count: 1 }]);
  assert.equal(store.deleteNote(a.id), true);
  assert.equal(store.deleteNote(a.id), false);
  assert.equal(store.getNote(a.id), null);
  assert.equal(store.updateNote(9999, {}), null);
  assert.deepEqual(store.listTags(), [{ name: 'work', count: 1 }]);
  const raw = new DatabaseSync(path);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM note_tags WHERE note_id=?').get(a.id).n, 0);
  raw.close();
  assert.equal(store.getNote(b.id).text, b.text);
});

test('invalid creates, patches and every import field leave state unchanged', t => {
  const store = openStore(':memory:'); t.after(() => store.close());
  const n = store.createNote('original', ['safe']);
  for (const text of [null, 1, '', '  ', 'a'.repeat(4001)]) assert.throws(() => store.createNote(text));
  for (const tags of [null, 'x', [1], [''], ['x'.repeat(41)], ['ok', false]]) {
    assert.throws(() => store.createNote('valid', tags));
    assert.throws(() => store.updateNote(n.id, { text: 'changed', tags }));
    assert.throws(() => importNotes(store, [{ text: 'first', tags: ['new'] }, { text: 'second', tags }]));
    assert.deepEqual(store.listNotes(), [n]);
    assert.deepEqual(store.listTags(), [{ name: 'safe', count: 1 }]);
  }
  assert.throws(() => importNotes(store, [{ text: 'valid' }, { text: '' }]));
  assert.deepEqual(store.listNotes(), [n]);
  for (const options of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { offset: -1 }, { offset: 0.5 }, { q: 7 }, { tag: '' }]) assert.throws(() => store.listNotes(options));
  assert.throws(() => store.transaction(() => { store.createNote('rolled back'); throw new Error('rollback'); }));
  assert.deepEqual(store.listNotes(), [n]);
});

test('persistent database and complete export/import over multiple pages', t => {
  const path = fixture(t);
  let store = openStore(path);
  const imported = importNotes(store, Array.from({ length: 105 }, (_, i) => ({ text: `note ${i}`, tags: ['Batch'] })));
  const exported = exportNotes(store);
  assert.equal(exported.notes.length, 105);
  assert.deepEqual(exported.notes[0], { text: 'note 0', tags: ['batch'] });
  store.close(); store = openStore(path); t.after(() => store.close());
  assert.deepEqual(store.getNote(imported[0].id), imported[0]);
  assert.equal(allNotes(store)[0].id, imported.at(-1).id);
  assert.deepEqual(store.listTags(), [{ name: 'batch', count: 105 }]);
});
