import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openStore } from '../src/store.mjs';
import { importNotes } from '../src/import.mjs';
import { allNotes, exportNotes } from '../src/service.mjs';

test('normalization, literal filters, updates and cascades', () => {
  const s = openStore(':memory:');
  try {
    const n = s.createNote('  100%_Écho  ', [' Work ', 'work', 'HOME']);
    assert.deepEqual(n.tags, ['home', 'work']);
    assert.equal(n.text, '100%_Écho');
    s.createNote('unrelated', ['work']);
    assert.deepEqual(s.listNotes({ q: '%_é', tag: ' HOME ' }), [n]);
    assert.equal(s.listNotes({ limit: 1, offset: 1 })[0].id, n.id);
    assert.throws(() => s.updateNote(n.id, { text: 'changed', tags: ['good', ''] }));
    assert.deepEqual(s.getNote(n.id), n);
    const updated = s.updateNote(n.id, { text: ' new ', tags: ['New'] });
    assert.equal(updated.text, 'new');
    assert.equal(updated.createdAt, n.createdAt);
    assert.ok(updated.updatedAt > n.updatedAt);
    assert.deepEqual(updated.tags, ['new']);
    assert.ok(s.updateNote(n.id, {}).updatedAt > updated.updatedAt);
    assert.equal(s.deleteNote(n.id), true);
    assert.equal(s.deleteNote(n.id), false);
    assert.equal(s.getNote(n.id), null);
    assert.equal(s.updateNote(n.id, {}), null);
    assert.deepEqual(s.listTags(), [{ name: 'work', count: 1 }]);
    for (const options of [{ limit: 0 }, { limit: 101 }, { offset: -1 }, { offset: 0.5 }]) assert.throws(() => s.listNotes(options));
    for (const text of [null, 123, '', ' ', 'x'.repeat(4001)]) assert.throws(() => s.createNote(text));
    for (const tags of [null, 'tag', [''], [42], ['x'.repeat(41)]]) assert.throws(() => s.createNote('bad', tags));
  } finally { s.close(); }
});

test('import validates every field before writing, transactions roll back', () => {
  const s = openStore(':memory:');
  try {
    const existing = s.createNote('existing');
    for (const bad of [{ text: '' }, { text: 'bad', tags: [null] }, { text: 'bad', tags: 'oops' }]) {
      assert.throws(() => importNotes(s, [{ text: 'valid' }, bad]));
      assert.deepEqual(s.listNotes(), [existing]);
    }
    assert.throws(() => s.transaction(() => { s.createNote('rollback'); throw new Error('fail'); }));
    assert.deepEqual(s.listNotes(), [existing]);
    assert.equal(importNotes(s, [{ text: ' next ', tags: [' Tag '] }])[0].text, 'next');
  } finally { s.close(); }
});

test('persistence and exports beyond the default page', () => {
  const dir = mkdtempSync(join(process.cwd(), '.test-store-'));
  const path = join(dir, 'nested', 'notes.sqlite');
  let s = openStore(path);
  try {
    for (let i = 0; i < 125; i++) s.createNote(`note ${i}`, ['test']);
    s.close(); s = openStore(path);
    assert.equal(allNotes(s).length, 125);
    const exported = exportNotes(s);
    assert.equal(exported.version, 1);
    assert.deepEqual(exported.notes[0], { text: 'note 0', tags: ['test'] });
    assert.equal(exported.notes.at(-1).text, 'note 124');
  } finally { s.close(); rmSync(dir, { recursive: true, force: true }); }
});
