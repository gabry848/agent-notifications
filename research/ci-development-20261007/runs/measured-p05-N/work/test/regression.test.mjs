import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm, readdir} from 'node:fs/promises';
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
const record = (id, patch = {}) => ({id,name:id.toUpperCase(),version:'1.0.0',tags:[],dependencies:[],...patch});

test('CSV quoting, separators, whitespace and strict malformed input', () => {
  const rows = [['a,b','c"d','line\r\nbreak','  space  ',''],['','tail','','','']];
  assert.deepEqual(parseCSV(stringifyCSV(rows) + '\r\n'),rows);
  assert.deepEqual(parseCSV(''),[]);
  assert.deepEqual(parseCSV('\n'),[['']]);
  assert.deepEqual(parseCSV('a,\nb,'),[['a',''],['b','']]);
  for (const input of ['"open','x"y','"x"y','"x" "y"']) assert.throws(() => parseCSV(input));
});

test('semantic precedence and invalid version rejection', () => {
  const ordered = ['1.0.0-alpha','1.0.0-alpha.2','1.0.0-alpha.10','1.0.0-beta','1.0.0','1.2.0','1.10.0','2.0.0'];
  for (let i = 0; i < ordered.length; i++) for (let j = 0; j < ordered.length; j++) assert.equal(compareVersions(ordered[i],ordered[j]),i === j ? 0 : i < j ? -1 : 1);
  assert.deepEqual(parseVersion('0.2.3-abc-def.0'),{major:0,minor:2,patch:3,prerelease:['abc-def','0']});
  for (const v of ['',null,'1.2','01.2.3','1.2.3+build','1.2.3-01','1.2.3-','1.2.3-a..b','1.2.3\n']) assert.throws(() => parseVersion(v));
});

test('catalog normalization, deep copies and transactional rollback', () => {
  const seed = record(' z ',{name:' Zed ',tags:[' WEB ','web','','TOOLS'],dependencies:['a','a','b']});
  const catalog = createCatalog([seed]); seed.tags.push('mutated');
  assert.deepEqual(catalog.get('z'),record('z',{name:'Zed',tags:['tools','web'],dependencies:['a','b']}));
  catalog.get('z').tags.push('mutated'); catalog.list()[0].dependencies.length = 0;
  const before = catalog.list();
  assert.throws(() => catalog.applyBatch([{type:'update',id:'z',patch:{name:'changed'}},{type:'add',record:record('z')}]),/Duplicate/);
  assert.deepEqual(catalog.list(),before);
  assert.throws(() => catalog.update('z',{id:'x'}));
  assert.throws(() => catalog.update('unknown',{}));
  for (const bad of [null,record(''),record('x',{tags:[2]}),record('x',{version:'oops'})]) assert.throws(() => catalog.add(bad));
  assert.deepEqual(catalog.list(),before);
  catalog.applyBatch([{type:'add',record:record('a')},{type:'remove',id:'z'}]);
  assert.deepEqual(catalog.list().map(r => r.id),['a']);
});

test('search combines predicates, semantic sorting, fixed ascending tie break and paging', () => {
  const records = [record('b',{name:'Shared',tags:['web','tool'],version:'1.10.0'}),record('a',{name:'Shared',tags:['web'],version:'1.2.0'}),record('c',{name:'Other',version:'1.0.0-beta'})];
  const original = structuredClone(records);
  assert.deepEqual(searchRecords(records,{text:' SHAR ',tags:[' WEB '],sortBy:'name',order:'desc',limit:1}).items.map(r => r.id),['a']);
  assert.deepEqual(searchRecords(records,{sortBy:'version',order:'desc',offset:1}).items.map(r => r.id),['a','c']);
  assert.equal(searchRecords(records,{tags:['web','tool'],versionMin:'1.2.0',versionMax:'1.10.0'}).total,1);
  for (const q of [{limit:0},{limit:101},{offset:-1},{offset:1.5},{sortBy:'bad'},{order:'bad'},{versionMin:'bad'},{tags:'web'}]) assert.throws(() => searchRecords(records,q));
  assert.deepEqual(records,original);
});

test('graph preserves DFS dependency order, reverse reachability and reports cycles/missing nodes', () => {
  const records = [record('a',{dependencies:['c','b']}),record('b',{dependencies:['d']}),record('c',{dependencies:['d']}),record('d')];
  assert.deepEqual(planDependencies(records,['a','b']),['d','c','b','a']);
  assert.deepEqual(reverseDependencies(records,'d'),['a','b','c']);
  assert.throws(() => planDependencies(records,['missing']),/missing/);
  assert.throws(() => planDependencies([record('a',{dependencies:['b']}),record('b',{dependencies:['a']})],['a']),/a.*b.*a/);
  assert.throws(() => reverseDependencies(records,'missing'),/missing/);
});

test('CSV and NDJSON transfers are atomic and UTF-8 chunk-safe', async () => {
  const records = [record('a',{name:'Café ☃, "package"\nnext',tags:['web','tools']}),record('b',{dependencies:['a']})];
  const source = createCatalog(records), csv = exportCSV(source.list()), target = createCatalog();
  assert.deepEqual(importCSV(csv,target),source.list());
  const before = target.list();
  assert.throws(() => importCSV(exportCSV([record('c'),record('a')]),target));
  assert.deepEqual(target.list(),before);
  assert.throws(() => importCSV('name,id,version,tags,dependencies',target),/header/);
  let ndjson = ''; for await (const line of exportNDJSON(source.list())) ndjson += line;
  const bytes = Buffer.from('\n' + ndjson.trimEnd());
  async function* chunks() { for (const byte of bytes) yield Buffer.from([byte]); }
  const other = createCatalog();
  assert.deepEqual(await importNDJSON(chunks(),other),source.list());
  await assert.rejects(importNDJSON([JSON.stringify(record('c')) + '\n{broken'],other));
  await assert.rejects(importNDJSON([JSON.stringify(record('c')) + '\n' + JSON.stringify(record('d',{version:'bad'}))],other));
  assert.deepEqual(other.list(),source.list());
});

test('HTTP CRUD, query validation, imports, encoded ids and body limit', async t => {
  const catalog = createCatalog(), server = createServer(catalog);
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path,method = 'GET',body) => fetch(base + path,{method,body:body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)});
  assert.deepEqual(await (await request('/health')).json(),{ok:true});
  assert.equal((await request('/records','POST',record('a/b'))).status,201);
  assert.equal((await request('/records','POST',record('a/b'))).status,409);
  assert.equal((await request('/records/a%2Fb')).status,200);
  assert.equal((await request('/records/a%2Fb','PATCH',{name:'New'})).status,200);
  assert.equal((await request('/records/a%2Fb','PATCH',{id:'bad'})).status,400);
  assert.equal((await request('/records?limit=')).status,400);
  assert.equal((await request('/records','POST','{broken')).status,400);
  assert.equal((await request('/records','POST','x'.repeat(1024*1024+1))).status,413);
  assert.equal((await request('/import.csv','POST',exportCSV([record('b',{dependencies:['a/b']})]))).status,201);
  assert.deepEqual(await (await request('/plan?ids=b')).json(),{ids:['a/b','b']});
  assert.equal((await request('/import.ndjson','POST',JSON.stringify(record('c')) + '\n')).status,201);
  const exported = await request('/export.ndjson');
  assert.match(exported.headers.get('content-type'),/application\/x-ndjson/);
  assert.equal((await exported.text()).trim().split('\n').length,3);
  const csv = await request('/export.csv'); assert.match(csv.headers.get('content-type'),/text\/csv/);
  assert.equal(parseCSV(await csv.text()).length,4);
  assert.equal((await request('/records/a%2Fb','DELETE')).status,204);
  assert.equal((await request('/records/a%2Fb')).status,404);
  assert.equal((await request('/unknown')).status,404);
  assert.equal((await request('/health')).status,200);
});

test('CLI subprocess persists only validated writes and supports all commands', async t => {
  const dir = await mkdtemp(join(tmpdir(),'catalog-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const file = join(dir,'data.json'), input = join(dir,'input.csv');
  const cli = (command,...args) => spawnSync(process.execPath,['src/cli.mjs',command,'--file',file,...args],{encoding:'utf8'});
  assert.equal(JSON.parse(cli('list').stdout).total,0);
  assert.equal(cli('add','--record',JSON.stringify(record('a'))).status,0);
  const before = await readFile(file,'utf8');
  for (const result of [cli('add','--record',JSON.stringify(record('a'))),cli('add','--record','{bad'),cli('remove'),cli('unknown')]) {
    assert.notEqual(result.status,0); assert.ok(result.stderr); assert.equal(await readFile(file,'utf8'),before);
  }
  await writeFile(input,exportCSV([record('b',{dependencies:['a']})]));
  assert.equal(JSON.parse(cli('import-csv','--input',input).stdout).added,1);
  assert.deepEqual(JSON.parse(cli('plan','--ids','b').stdout).ids,['a','b']);
  assert.equal(parseCSV(cli('export-csv').stdout).length,3);
  assert.equal(JSON.parse(cli('list','--text','b').stdout).total,1);
  assert.equal(JSON.parse(cli('remove','--id','a').stdout),true);
  assert.deepEqual((await readdir(dir)).sort(),['data.json','input.csv']);
  assert.notEqual(spawnSync(process.execPath,['src/cli.mjs','list'],{encoding:'utf8'}).status,0);
});
