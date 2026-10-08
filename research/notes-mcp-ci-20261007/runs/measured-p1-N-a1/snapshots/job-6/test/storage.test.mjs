import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/store.mjs';
import { importNotes, exportNotes, allNotes } from '../src/import.mjs';

test('storage normalization, literal filters, updates and validation are atomic', () => {
  const s = openStore(':memory:');
  try {
    const a = s.createNote('  Hello %_ World  ', [' Work ', 'work', 'Z', 'a']);
    assert.equal(a.text, 'Hello %_ World');
    assert.deepEqual(a.tags, ['a', 'work', 'z']);
    const b = s.createNote('hello elsewhere', ['work']);
    assert.deepEqual(s.listNotes({ q: '%_' }).map(n => n.id), [a.id]);
    assert.deepEqual(s.listNotes({ q: 'HELLO', tag: ' WORK ', limit: 1, offset: 1 }), [a]);
    for (const text of ['', ' ', 4, null, 'x'.repeat(4001)]) assert.throws(() => s.createNote(text));
    for (const tags of [null, 'work', [''], [2], ['x'.repeat(41)]]) {
      assert.throws(() => s.createNote('valid', tags));
      assert.throws(() => s.updateNote(a.id, { text: 'changed', tags }));
      assert.deepEqual(s.getNote(a.id), a);
      assert.throws(() => importNotes(s, [{ text: 'first' }, { text: 'later', tags }]));
      assert.equal(s.listNotes().length, 2);
    }
    assert.throws(() => importNotes(s, [{ text: 'first' }, { text: ' ' }]));
    const updated = s.updateNote(a.id, { tags: [' NEW '] });
    assert.equal(updated.createdAt, a.createdAt);
    assert.ok(updated.updatedAt > a.updatedAt);
    assert.deepEqual(updated.tags, ['new']);
    assert.ok(s.updateNote(a.id, {}).updatedAt > updated.updatedAt);
    assert.equal(s.getNote(999), null);
    assert.equal(s.updateNote(999, {}), null);
    assert.equal(s.deleteNote(999), false);
    for (const query of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { offset: -1 }, { offset: '1' }, { q: 5 }, { tag: '' }]) assert.throws(() => s.listNotes(query));
    assert.equal(s.deleteNote(a.id), true);
    assert.deepEqual(s.listTags(), [{ name: 'work', count: 1 }]);
    assert.deepEqual(s.listNotes(), [b]);
  } finally { s.close(); }
});

test('disk persistence, foreign keys, transaction rollback and complete exports', () => {
  const dir = mkdtempSync(join('test', '.storage-'));
  const file = join(dir, 'nested', 'notes.sqlite');
  let s = openStore(file);
  try {
    const notes = importNotes(s, Array.from({ length: 125 }, (_, i) => ({ text: `note ${i}`, tags: ['batch'] })));
    assert.equal(allNotes(s).length, 125);
    assert.deepEqual(exportNotes(s), { version: 1, notes: notes.map(({ text, tags }) => ({ text, tags })) });
    assert.throws(() => s.transaction(() => { s.createNote('rollback'); throw new Error('abort'); }));
    assert.equal(allNotes(s).length, 125);
    s.close(); s = openStore(file);
    assert.deepEqual(s.getNote(notes[0].id), notes[0]);
    s.deleteNote(notes[0].id);
    const db = new DatabaseSync(file);
    try { assert.equal(db.prepare('SELECT COUNT(*) AS n FROM note_tags WHERE note_id=?').get(notes[0].id).n, 0); }
    finally { db.close(); }
  } finally { s.close(); rmSync(dir, { recursive: true, force: true }); }
});
