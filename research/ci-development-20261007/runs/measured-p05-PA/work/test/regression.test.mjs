import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCSV, stringifyCSV} from '../src/csv.mjs';
import {parseVersion, compareVersions} from '../src/version.mjs';
import {createCatalog} from '../src/catalog.mjs';
import {searchRecords} from '../src/search.mjs';
import {planDependencies, reverseDependencies} from '../src/graph.mjs';
import {exportCSV, importCSV, exportNDJSON, importNDJSON} from '../src/transfer.mjs';

const record = (id, extra = {}) => ({id, name: id.toUpperCase(), version: '1.0.0', tags: [], dependencies: [], ...extra});

test('CSV preserves quoting, whitespace, multiline fields and empty fields', () => {
  const rows = [[' a ', 'a,b', 'say "hello"', 'line\r\nnext', ''], ['', 'x']];
  assert.deepEqual(parseCSV(stringifyCSV(rows)), rows);
  assert.deepEqual(parseCSV('a,b\r\n'), [['a', 'b']]);
  assert.deepEqual(parseCSV(''), []);
  assert.deepEqual(parseCSV('""'), [['']]);
  for (const bad of ['"open', 'a"b', '"a"x']) assert.throws(() => parseCSV(bad));
});

test('semantic version validation and ordering, including large integers', () => {
  assert.deepEqual(parseVersion('1.2.3-alpha-x.2'), {major: 1, minor: 2, patch: 3, prerelease: ['alpha-x', '2']});
  for (const bad of ['1.2', '01.2.3', '1.2.3-01', '1.2.3+meta', '1.2.3\n', '1.2.3-', '1.2.3-a..b']) assert.throws(() => parseVersion(bad));
  const versions = ['1.0.0-alpha', '1.0.0-alpha.2', '1.0.0-alpha.10', '1.0.0-beta', '1.0.0', '1.0.1', '2.0.0'];
  for (let i = 1; i < versions.length; i++) {
    assert.equal(compareVersions(versions[i - 1], versions[i]), -1);
    assert.equal(compareVersions(versions[i], versions[i - 1]), 1);
  }
  assert.equal(compareVersions('9007199254740992.0.0', '9007199254740993.0.0'), -1);
});

test('catalog owns copies, normalizes values and rolls back batches', () => {
  const input = record(' a ', {name: ' A ', tags: [' WEB ', 'web', '', 'Tools'], dependencies: ['b', 'b']});
  const catalog = createCatalog([input]);
  input.tags.push('changed');
  assert.deepEqual(catalog.get('a'), record('a', {tags: ['tools', 'web'], dependencies: ['b']}));
  const returned = catalog.get('a'); returned.dependencies.push('c');
  const listed = catalog.list(); listed[0].tags.push('changed');
  assert.deepEqual(catalog.get('a').dependencies, ['b']);
  const before = catalog.list();
  assert.throws(() => catalog.applyBatch([{type: 'update', id: 'a', patch: {name: 'New'}}, {type: 'add', record: record('b')}, {type: 'add', record: record('a')}]));
  assert.deepEqual(catalog.list(), before);
  assert.throws(() => catalog.update('a', {id: 'z'}));
  assert.throws(() => catalog.update('missing', {}));
  assert.throws(() => catalog.add(record('x', {tags: [1]})));
  assert.deepEqual(catalog.list(), before);
  assert.deepEqual(catalog.applyBatch([{type: 'add', record: record('b')}, {type: 'remove', id: 'a'}]), [record('b'), true]);
});

test('search filters together, respects semantic order and ascending id ties', () => {
  const records = [record('b', {name: 'same', tags: ['web', 'tools'], version: '2.0.0'}), record('a', {name: 'same', tags: ['web', 'tools'], version: '2.0.0'}), record('c', {version: '10.0.0'})];
  const before = structuredClone(records);
  const result = searchRecords(records, {text: ' SAME ', tags: [' WEB ', 'tools'], versionMin: '2.0.0', versionMax: '2.0.0', sortBy: 'name', order: 'desc', limit: 1, offset: 1});
  assert.equal(result.total, 2); assert.equal(result.items[0].id, 'b');
  assert.deepEqual(searchRecords(records, {sortBy: 'version'}).items.map(r => r.id), ['a', 'b', 'c']);
  result.items[0].tags.push('new'); assert.deepEqual(records, before);
  for (const query of [{offset: -1}, {limit: 101}, {limit: '2'}, {order: 'up'}, {sortBy: 'tags'}, {versionMin: 'bad'}]) assert.throws(() => searchRecords(records, query));
});

test('dependency traversal preserves DFS order and handles reverse cycles', () => {
  const records = [record('a', {dependencies: ['c', 'b']}), record('b', {dependencies: ['d']}), record('c', {dependencies: ['d']}), record('d')];
  const before = structuredClone(records);
  assert.deepEqual(planDependencies(records, ['a', 'b']), ['d', 'c', 'b', 'a']);
  assert.deepEqual(reverseDependencies(records, 'd'), ['a', 'b', 'c']);
  assert.deepEqual(records, before);
  assert.throws(() => planDependencies(records, ['missing']), /missing/i);
  const cycle = [record('x', {dependencies: ['y']}), record('y', {dependencies: ['x']})];
  assert.throws(() => planDependencies(cycle, ['x']), /x.*y.*x/);
  assert.deepEqual(reverseDependencies(cycle, 'x'), ['y']);
});

test('CSV import is atomic for late invalid records and duplicate ids', () => {
  const catalog = createCatalog([record('existing')]);
  const records = [record('a', {name: 'A, "quoted"\nname', tags: ['web'], dependencies: ['existing']})];
  assert.deepEqual(importCSV(exportCSV(records), catalog), records);
  const before = catalog.list();
  assert.throws(() => importCSV(exportCSV([record('b'), record('c', {version: 'invalid'})]), catalog));
  assert.throws(() => importCSV(exportCSV([record('b'), record('b')]), catalog));
  assert.throws(() => importCSV('name,id,version,tags,dependencies\n', catalog));
  assert.deepEqual(catalog.list(), before);
});

test('NDJSON decodes each split UTF-8 byte and commits only after complete validation', async () => {
  const input = [record('a', {name: 'Café 🌍'}), record('b')];
  let text = '';
  for await (const line of exportNDJSON(input)) text += line;
  const bytes = Buffer.from('\n' + text.trimEnd());
  async function* chunks() { for (let i = 0; i < bytes.length; i++) yield bytes.subarray(i, i + 1); }
  const catalog = createCatalog();
  assert.deepEqual(await importNDJSON(chunks(), catalog), input);
  const before = catalog.list();
  await assert.rejects(importNDJSON([JSON.stringify(record('c')) + '\n', '{broken}'], catalog));
  await assert.rejects(importNDJSON([JSON.stringify(record('c')) + '\n' + JSON.stringify(record('a'))], catalog));
  async function* brokenStream() { yield JSON.stringify(record('c')) + '\n'; throw new Error('stream failure'); }
  await assert.rejects(importNDJSON(brokenStream(), catalog), /stream failure/);
  assert.deepEqual(catalog.list(), before);
});
