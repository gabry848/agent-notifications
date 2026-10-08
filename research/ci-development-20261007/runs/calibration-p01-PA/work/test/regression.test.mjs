import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import {mkdtemp, readFile, writeFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {parseCSV, stringifyCSV} from '../src/csv.mjs';
import {parseVersion, compareVersions} from '../src/version.mjs';
import {createCatalog} from '../src/catalog.mjs';
import {searchRecords} from '../src/search.mjs';
import {planDependencies, reverseDependencies} from '../src/graph.mjs';
import {exportCSV, importCSV, exportNDJSON, importNDJSON} from '../src/transfer.mjs';
import {createServer} from '../src/server.mjs';
const record = (id, patch = {}) => ({id, name: id.toUpperCase(), version: '1.0.0', tags: [], dependencies: [], ...patch});

test('CSV preserves spaces, quoting, multiline fields and final separators', () => {
  const rows = [[' space ', 'a,b', 'say "hello"', 'line\r\nbreak', ''], ['', 'x', '', '', '']];
  assert.deepEqual(parseCSV(stringifyCSV(rows) + '\r\n'), rows);
  assert.deepEqual(parseCSV(''), []);
  assert.deepEqual(parseCSV('\n'), [['']]);
  assert.deepEqual(parseCSV('a,'), [['a', '']]);
  for (const bad of ['"unclosed', 'a"b', '"x"tail']) assert.throws(() => parseCSV(bad));
});

test('semantic versions validate strictly and compare exactly', () => {
  assert.deepEqual(parseVersion('1.2.3-alpha-beta.12'), {major: 1, minor: 2, patch: 3, prerelease: ['alpha-beta', '12']});
  const ordered = ['1.0.0-alpha', '1.0.0-alpha.2', '1.0.0-alpha.11', '1.0.0-beta', '1.0.0', '1.2.0', '1.10.0'];
  for (let i = 1; i < ordered.length; i++) {
    assert.equal(compareVersions(ordered[i - 1], ordered[i]), -1);
    assert.equal(compareVersions(ordered[i], ordered[i - 1]), 1);
  }
  assert.equal(compareVersions('9007199254740992.0.0', '9007199254740993.0.0'), -1);
  for (const bad of ['1.2', '01.2.3', '1.2.3-01', '1.2.3-', '1.2.3+build', '1.2.3-a..b', ' 1.2.3', null]) assert.throws(() => parseVersion(bad));
});

test('catalog normalizes, isolates copies and rolls back failed batches', () => {
  const seed = record(' b ', {name: ' Bee ', tags: [' Web ', 'web', '', 'TOOLS'], dependencies: ['a', 'a']});
  const c = createCatalog([seed, record('a')]);
  seed.tags.push('changed');
  assert.deepEqual(c.get('b'), record('b', {name: 'Bee', tags: ['tools', 'web'], dependencies: ['a']}));
  const view = c.list(); view[0].name = 'changed'; view[1].dependencies.push('changed');
  assert.equal(c.get('a').name, 'A'); assert.deepEqual(c.get('b').dependencies, ['a']);
  const before = c.list();
  assert.throws(() => c.applyBatch([{type: 'update', id: 'a', patch: {tags: ['new']}}, {type: 'remove', id: 'b'}, {type: 'add', record: record('a')}]));
  assert.deepEqual(c.list(), before);
  assert.throws(() => c.update('a', {id: 'b'}));
  assert.throws(() => c.update('a', {version: 'bad'}));
  assert.throws(() => c.add(record(' a ')));
  assert.throws(() => c.add(record('c', {tags: [5]})));
  assert.deepEqual(c.list(), before);
  const result = c.applyBatch([{type: 'add', record: record('z')}, {type: 'update', id: 'z', patch: {name: 'Zed'}}]);
  result[1].tags.push('oops'); assert.deepEqual(c.get('z').tags, []);
  assert.equal(c.remove('z'), true); assert.equal(c.remove('z'), false);
});

test('search combines filters, paginates, and keeps ascending id tie-breaks', () => {
  const records = createCatalog([record('b', {name: 'same', version: '1.2.0', tags: ['WEB', 'tools']}), record('a', {name: 'same', version: '1.2.0', tags: ['web', 'tools']}), record('c', {version: '1.2.0-alpha', tags: ['web']})]).list();
  const before = structuredClone(records);
  const result = searchRecords(records, {text: ' SAME ', tags: [' Web ', 'TOOLS'], versionMin: '1.2.0', versionMax: '1.2.0', sortBy: 'name', order: 'desc', offset: 1, limit: 1});
  assert.deepEqual(result, {items: [records[1]], total: 2, offset: 1, limit: 1});
  assert.deepEqual(searchRecords(records, {sortBy: 'version', order: 'desc'}).items.map(r => r.id), ['a', 'b', 'c']);
  result.items[0].tags.push('new'); assert.deepEqual(records, before);
  for (const query of [{sortBy: 'bad'}, {order: 'bad'}, {offset: -1}, {offset: '0'}, {limit: 101}, {limit: 0}, {limit: 1.5}, {tags: 'web'}, {versionMin: 'bad'}]) assert.throws(() => searchRecords(records, query));
});

test('graph respects traversal order, handles cycles and reverse reachability', () => {
  const records = [record('a', {dependencies: ['b', 'c']}), record('b', {dependencies: ['d']}), record('c', {dependencies: ['d']}), record('d')];
  const before = structuredClone(records);
  assert.deepEqual(planDependencies(records, ['c', 'a', 'd']), ['d', 'c', 'b', 'a']);
  assert.deepEqual(reverseDependencies(records, 'd'), ['a', 'b', 'c']);
  assert.deepEqual(records, before);
  assert.throws(() => planDependencies(records, ['missing']), /missing/);
  assert.throws(() => reverseDependencies(records, 'missing'), /missing/);
  const cyclic = [record('x', {dependencies: ['y']}), record('y', {dependencies: ['x']})];
  assert.throws(() => planDependencies(cyclic, ['x']), /cycle.*x.*y.*x/);
  assert.deepEqual(reverseDependencies(cyclic, 'x'), ['y']);
});

test('CSV transfers validate all rows before committing', () => {
  const records = [record('a', {name: 'Comma, "quote"\nname', tags: ['one', 'two'], dependencies: ['b']}), record('b')];
  const c = createCatalog();
  assert.deepEqual(importCSV(exportCSV(records), c), records);
  const before = c.list();
  assert.throws(() => importCSV(exportCSV([record('new'), record('a')]), c));
  assert.throws(() => importCSV('id,name,version,tags,dependencies\nx,X,1.0.0,,\ny,Y,bad,,', c));
  assert.throws(() => importCSV('name,id,version,tags,dependencies', c));
  assert.deepEqual(c.list(), before);
});

test('NDJSON decodes split UTF-8, ignores blanks and imports atomically', async () => {
  const records = [record('café', {name: '☕😀'}), record('b')];
  let output = ''; for await (const line of exportNDJSON(records)) output += line;
  const bytes = Buffer.from('\n' + output.trimEnd());
  async function* pieces() { for (const byte of bytes) yield Buffer.from([byte]); }
  const c = createCatalog();
  assert.deepEqual(await importNDJSON(pieces(), c), records);
  const before = c.list();
  await assert.rejects(importNDJSON([JSON.stringify(record('new')) + '\n{broken'], c));
  await assert.rejects(importNDJSON([JSON.stringify(record('new')) + '\n' + JSON.stringify(record('bad', {tags: null}))], c));
  await assert.rejects(importNDJSON([JSON.stringify(record('new')) + '\n' + JSON.stringify(record('new'))], c));
  assert.deepEqual(c.list(), before);
});

async function withServer(t, catalog = createCatalog()) {
  const server = createServer(catalog); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {server, base, catalog, request: (path, method = 'GET', body) => fetch(base + path, {method, body})};
}

test('HTTP CRUD, search, dependency plan, transfer and error recovery integrate', async t => {
  const {request} = await withServer(t);
  assert.deepEqual(await (await request('/health')).json(), {ok: true});
  let res = await request('/records', 'POST', JSON.stringify(record('a/b', {tags: ['Web']})));
  assert.equal(res.status, 201);
  assert.equal((await res.json()).id, 'a/b');
  assert.equal((await request('/records', 'POST', JSON.stringify(record('a/b')))).status, 409);
  assert.equal((await request('/records/a%2Fb')).status, 200);
  res = await request('/records/a%2Fb', 'PATCH', JSON.stringify({name: 'New Name'}));
  assert.equal((await res.json()).name, 'New Name');
  res = await request('/records?text=new&tags=WEB&limit=1');
  assert.equal((await res.json()).total, 1);
  assert.deepEqual(await (await request('/plan?ids=a%2Fb')).json(), {ids: ['a/b']});
  assert.equal((await request('/records?limit=')).status, 400);
  assert.equal((await request('/records/a%ZZ')).status, 400);
  assert.equal((await request('/records/absent')).status, 404);
  assert.equal((await request('/unknown')).status, 404);
  assert.equal((await request('/records', 'POST', '{')).status, 400);
  const csv = await (await request('/export.csv')).text();
  assert.equal((await request('/records/a%2Fb', 'DELETE')).status, 204);
  assert.equal((await request('/import.csv', 'POST', csv)).status, 201);
  res = await request('/export.ndjson'); assert.match(res.headers.get('content-type'), /application\/x-ndjson/);
  const ndjson = await res.text();
  assert.equal((await request('/records/a%2Fb', 'DELETE')).status, 204);
  assert.deepEqual(await (await request('/import.ndjson', 'POST', ndjson)).json(), {added: 1});
  assert.equal((await request('/import.ndjson', 'POST', JSON.stringify(record('new')) + '\n{bad')).status, 400);
  assert.equal((await request('/records/new')).status, 404);
  assert.equal((await request('/records', 'POST', 'x'.repeat(1024 * 1024 + 1))).status, 413);
  assert.equal((await request('/health')).status, 200);
});

test('HTTP chunked oversized bodies return JSON 413 without breaking server', async t => {
  const {base, request} = await withServer(t);
  const response = await new Promise((resolve, reject) => {
    const req = http.request(base + '/import.ndjson', {method: 'POST', headers: {'Transfer-Encoding': 'chunked'}}, res => {
      let text = ''; res.on('data', c => text += c); res.on('end', () => resolve({status: res.statusCode, text}));
    });
    req.on('error', reject);
    req.write('x'.repeat(600000)); req.end('x'.repeat(600000));
  });
  assert.equal(response.status, 413); assert.equal(typeof JSON.parse(response.text).error, 'string');
  assert.equal((await request('/health')).status, 200);
});

test('CLI persists validated records atomically and leaves data untouched on errors', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'package-catalog-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const file = join(dir, 'records.json');
  const cli = (...args) => spawnSync(process.execPath, ['src/cli.mjs', ...args], {encoding: 'utf8'});
  let result = cli('list', '--file', file); assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).total, 0);
  result = cli('add', '--file', file, '--record', JSON.stringify(record('a'))); assert.equal(result.status, 0);
  const before = await readFile(file, 'utf8');
  result = cli('add', '--file', file, '--record', JSON.stringify(record('a'))); assert.notEqual(result.status, 0); assert.match(result.stderr, /duplicate/);
  result = cli('add', '--file', file, '--record', '{broken'); assert.notEqual(result.status, 0);
  assert.equal(await readFile(file, 'utf8'), before);
  const input = join(dir, 'input.csv'); await writeFile(input, exportCSV([record('b', {dependencies: ['a']})]));
  assert.equal(cli('import-csv', '--file', file, '--input', input).status, 0);
  assert.deepEqual(JSON.parse(cli('plan', '--file', file, '--ids', 'b').stdout), {ids: ['a', 'b']});
  assert.equal(parseCSV(cli('export-csv', '--file', file).stdout).length, 3);
  assert.equal(JSON.parse(cli('remove', '--file', file, '--id', 'a').stdout), true);
  assert.deepEqual((await readdir(dir)).sort(), ['input.csv', 'records.json']);
  assert.notEqual(cli('list').status, 0);
  await writeFile(file, '{invalid'); assert.notEqual(cli('list', '--file', file).status, 0); assert.equal(await readFile(file, 'utf8'), '{invalid');
});
