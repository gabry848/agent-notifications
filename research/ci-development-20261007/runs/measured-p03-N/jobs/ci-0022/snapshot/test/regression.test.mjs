import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCSV, stringifyCSV} from '../src/csv.mjs';
import {parseVersion, compareVersions} from '../src/version.mjs';
import {createCatalog} from '../src/catalog.mjs';
import {searchRecords} from '../src/search.mjs';
import {planDependencies, reverseDependencies} from '../src/graph.mjs';
import {exportCSV, importCSV, exportNDJSON, importNDJSON} from '../src/transfer.mjs';
const record = (id, patch = {}) => ({id, name: id, version: '1.0.0', tags: [], dependencies: [], ...patch});
test('CSV preserves whitespace, quotes, empty fields and multiline data', () => {
  const rows = [[' x ', 'a,b', 'a"b', 'line\r\nbreak', ''], ['', 'last']];
  assert.deepEqual(parseCSV(stringifyCSV(rows) + '\r\n'), rows);
  assert.deepEqual(parseCSV(''), []);
  assert.deepEqual(parseCSV('\n'), [['']]);
  assert.deepEqual(parseCSV('a,'), [['a', '']]);
  for (const input of ['a"b,c', '"open', '"closed"x']) assert.throws(() => parseCSV(input));
});
test('semantic ordering and strict version syntax', () => {
  const ordered = ['1.0.0-alpha', '1.0.0-alpha.2', '1.0.0-alpha.10', '1.0.0-beta', '1.0.0', '1.2.0', '1.10.0'];
  for (let i = 1; i < ordered.length; i++) {
    assert.equal(compareVersions(ordered[i - 1], ordered[i]), -1);
    assert.equal(compareVersions(ordered[i], ordered[i - 1]), 1);
  }
  assert.deepEqual(parseVersion('0.2.3-alpha-beta.0'), {major: 0, minor: 2, patch: 3, prerelease: ['alpha-beta', '0']});
  for (const v of ['1.2', '01.0.0', '1.0.0-01', '1.0.0+build', '1.0.0-', '1.0.0\n', null]) assert.throws(() => parseVersion(v));
});
test('catalog normalizes and isolates state and rolls back entire transactions', () => {
  const seed = record(' a ', {name: ' A ', tags: [' Z ', 'z', '', 'B'], dependencies: ['x', 'x', 'y']});
  const c = createCatalog([seed]); seed.tags.push('oops');
  assert.deepEqual(c.get('a'), record('a', {name: 'A', tags: ['b', 'z'], dependencies: ['x', 'y']}));
  c.get('a').tags.push('oops'); c.list()[0].dependencies.pop();
  const before = c.list();
  assert.throws(() => c.applyBatch([{type: 'update', id: 'a', patch: {name: 'changed'}}, {type: 'add', record: record('b')}, {type: 'add', record: record('a')}]));
  assert.deepEqual(c.list(), before);
  assert.throws(() => c.update('a', {id: 'b'}));
  assert.throws(() => c.add(record('bad', {tags: [1]})));
  assert.deepEqual(c.list(), before);
  c.applyBatch([{type: 'remove', id: 'a'}, {type: 'add', record: record('a')}]);
  assert.equal(c.get('a').name, 'a');
});
test('search combines normalized filters, semantic bounds and stable descending ties', () => {
  const rows = [record('b', {name: 'Same', version: '1.10.0', tags: ['web']}), record('a', {name: 'Same', version: '1.2.0', tags: ['web', 'tools']}), record('c')];
  const before = structuredClone(rows);
  assert.deepEqual(searchRecords(rows, {sortBy: 'name', order: 'desc'}).items.map(r => r.id), ['c', 'a', 'b']);
  const result = searchRecords(rows, {text: ' SAME ', tags: [' WEB ', 'tools'], versionMin: '1.0.0', versionMax: '1.9.0', limit: 1});
  assert.equal(result.total, 1); assert.equal(result.items[0].id, 'a');
  result.items[0].tags.push('changed'); assert.deepEqual(rows, before);
  for (const query of [{offset: -1}, {limit: 101}, {limit: '2'}, {sortBy: 'bogus'}, {order: 'up'}, {versionMin: 'bad'}]) assert.throws(() => searchRecords(rows, query));
});
test('dependency DFS ordering, shared nodes, missing nodes and cycles', () => {
  const rows = [record('a', {dependencies: ['b', 'c']}), record('b', {dependencies: ['d']}), record('c', {dependencies: ['d']}), record('d')];
  assert.deepEqual(planDependencies(rows, ['a', 'b']), ['d', 'b', 'c', 'a']);
  assert.deepEqual(reverseDependencies(rows, 'd'), ['a', 'b', 'c']);
  assert.throws(() => planDependencies(rows, ['absent']), /absent/);
  const cyclic = [record('a', {dependencies: ['b']}), record('b', {dependencies: ['a']})];
  assert.throws(() => planDependencies(cyclic, ['a']), /cycle.*a.*b/i);
  assert.deepEqual(reverseDependencies(cyclic, 'a'), ['b']);
});
test('CSV and split UTF-8 NDJSON imports validate atomically', async () => {
  const rows = [record('a', {name: 'Café 🐈, "hello"\nworld', tags: ['web']}), record('b', {dependencies: ['a']})];
  const csvCatalog = createCatalog(); assert.deepEqual(importCSV(exportCSV(rows), csvCatalog), rows);
  assert.throws(() => importCSV(exportCSV([record('new'), record('a')]), csvCatalog));
  assert.deepEqual(csvCatalog.list(), rows);
  let text = ''; for await (const line of exportNDJSON(rows)) text += line;
  const bytes = Buffer.from('\n' + text.trimEnd());
  async function* chunks() { for (let i = 0; i < bytes.length; i++) yield bytes.subarray(i, i + 1); }
  const c = createCatalog(); assert.deepEqual(await importNDJSON(chunks(), c), rows);
  await assert.rejects(importNDJSON([JSON.stringify(record('new')) + '\n{bad}'], c));
  await assert.rejects(importNDJSON([JSON.stringify(record('new')) + '\n' + JSON.stringify(record('bad', {version: 'no'}))], c));
  assert.deepEqual(c.list(), rows);
});
