import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {parseCSV,stringifyCSV} from '../src/csv.mjs';
import {parseVersion,compareVersions} from '../src/version.mjs';
import {createCatalog} from '../src/catalog.mjs';
import {searchRecords} from '../src/search.mjs';
import {planDependencies,reverseDependencies} from '../src/graph.mjs';
import {exportCSV,importCSV,exportNDJSON,importNDJSON} from '../src/transfer.mjs';
import {createServer} from '../src/server.mjs';
const record=(id,dependencies=[])=>({id,name:`Package ${id}`,version:'1.0.0',tags:[' Web ','web'],dependencies});
test('CSV strict quoting, empty fields and whitespace',()=>{
  const rows=[[' a ','comma,quote"','line\r\nnext'],['','','tail']];
  assert.deepEqual(parseCSV(stringifyCSV(rows)+'\r\n'),rows);
  assert.deepEqual(parseCSV(''),[]);assert.deepEqual(parseCSV(',\n'),[['','']]);
  for(const bad of ['a"b','"unclosed','"a"x']) assert.throws(()=>parseCSV(bad));
});
test('semantic versions including large numeric identifiers',()=>{
  const ordered=['1.0.0-alpha','1.0.0-alpha.2','1.0.0-alpha.10','1.0.0-beta','1.0.0','2.0.0','10.0.0'];
  for(let i=1;i<ordered.length;i++) assert.equal(compareVersions(ordered[i-1],ordered[i]),-1);
  assert.equal(compareVersions('1.0.0-99999999999999999999','1.0.0-100000000000000000000'),-1);
  assert.deepEqual(parseVersion('0.1.2-a-b.0').prerelease,['a-b','0']);
  for(const bad of ['01.2.3','1.2','1.2.3+build','1.2.3-01','1.2.3-']) assert.throws(()=>parseVersion(bad));
});
test('catalog normalization, copy isolation and transactional rollback',()=>{
  const input=record(' a '), catalog=createCatalog([input]);input.tags.push('bad');
  assert.deepEqual(catalog.get('a').tags,['web']);
  const returned=catalog.get('a');returned.dependencies.push('bad');assert.deepEqual(catalog.get('a').dependencies,[]);
  assert.throws(()=>catalog.applyBatch([{type:'update',id:'a',patch:{name:'Changed'}},{type:'add',record:record('a')}]));
  assert.equal(catalog.get('a').name,'Package  a ' .trim());
  assert.throws(()=>catalog.update('a',{id:'b'}));assert.throws(()=>catalog.add({...record('b'),tags:[1]}));
});
test('search ties, all tags, semantic bounds and no mutation',()=>{
  const records=createCatalog([record('b'),record('a'),{...record('c'),version:'2.0.0'}]).list(), original=structuredClone(records);
  const result=searchRecords(records,{text:' PACKAGE ',tags:[' WEB '],versionMax:'1.0.0',sortBy:'version',order:'desc',limit:1});
  assert.equal(result.total,2);assert.equal(result.items[0].id,'a');result.items[0].tags.push('x');assert.deepEqual(records,original);
  for(const query of [{offset:-1},{limit:101},{limit:1.5},{order:'up'},{sortBy:'tags'},{versionMin:'bad'}]) assert.throws(()=>searchRecords(records,query));
});
test('dependency ordering, reverse closure and diagnostic failures',()=>{
  const records=[record('a',['b','c']),record('b',['d']),record('c',['d']),record('d')];
  assert.deepEqual(planDependencies(records,['a','b']),['d','b','c','a']);
  assert.deepEqual(reverseDependencies(records,'d'),['a','b','c']);
  assert.throws(()=>planDependencies([record('a',['absent'])],['a']),/absent/);
  assert.throws(()=>planDependencies([record('a',['b']),record('b',['a'])],['a']),/a.*b.*a/);
});
test('CSV and NDJSON imports are atomic; split UTF-8 and final lines',async()=>{
  const r={...record('é'),name:'Multiline, "name"\n😀'}, source=createCatalog([r]).list();
  const csvCatalog=createCatalog();assert.deepEqual(importCSV(exportCSV(source),csvCatalog),source);
  assert.throws(()=>importCSV(exportCSV([record('new'),...source]),csvCatalog));assert.equal(csvCatalog.get('new'),null);
  let text='';for await(const line of exportNDJSON(source)) text+=line;
  const bytes=Buffer.from('\n'+text.trimEnd());
  async function* chunks() {for(const byte of bytes) yield Buffer.from([byte]);}
  const target=createCatalog();assert.deepEqual(await importNDJSON(chunks(),target),source);
  await assert.rejects(importNDJSON([JSON.stringify(record('new'))+'\n{bad}'],target));assert.equal(target.get('new'),null);
  await assert.rejects(importNDJSON([JSON.stringify(record('new'))+'\n'+JSON.stringify({...record('bad'),version:'invalid'})],target));assert.equal(target.get('new'),null);
});
test('HTTP integration and errors do not terminate server',async t=>{
  const catalog=createCatalog(), server=createServer(catalog);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,method='GET',body)=>fetch(base+path,{method,body});
  assert.deepEqual(await (await request('/health')).json(),{ok:true});
  assert.equal((await request('/records','POST',JSON.stringify(record('a/b')))).status,201);
  assert.equal((await request('/records/a%2Fb')).status,200);
  assert.equal((await request('/records','POST',JSON.stringify(record('a/b')))).status,409);
  assert.equal((await request('/records/a%2Fb','PATCH','{bad')).status,400);
  assert.equal((await request('/records?offset=no')).status,400);
  assert.equal((await request('/records/missing')).status,404);
  assert.equal((await request('/import.ndjson','POST',JSON.stringify(record('new'))+'\nno')).status,400);
  assert.equal(catalog.get('new'),null);
  const oversize=await request('/records','POST','x'.repeat(1024*1024+1));assert.equal(oversize.status,413);
  assert.equal((await request('/health')).status,200);
  assert.deepEqual(await (await request('/plan?ids=a%2Fb')).json(),{ids:['a/b']});
  assert.equal((await request('/export.ndjson')).headers.get('content-type'),'application/x-ndjson');
  assert.equal((await request('/records/a%2Fb','DELETE')).status,204);
});
test('CLI persistence, search, import/export and failed-write protection',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'catalog-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=join(dir,'data.json');
  const run=(...args)=>spawnSync(process.execPath,['src/cli.mjs',...args,'--file',file],{encoding:'utf8'});
  assert.equal(JSON.parse(run('list').stdout).total,0);
  assert.equal(run('add','--record',JSON.stringify(record('a'))).status,0);
  const before=await readFile(file,'utf8');
  assert.notEqual(run('add','--record',JSON.stringify(record('a'))).status,0);assert.equal(await readFile(file,'utf8'),before);
  assert.notEqual(run('add','--record','{bad').status,0);assert.equal(await readFile(file,'utf8'),before);
  assert.equal(JSON.parse(run('list','--tags','web').stdout).total,1);
  assert.deepEqual(JSON.parse(run('plan','--ids','a').stdout),{ids:['a']});
  const input=join(dir,'input.csv');await writeFile(input,exportCSV([record('b')]));
  assert.equal(JSON.parse(run('import-csv','--input',input).stdout).added,1);
  assert.equal(parseCSV(run('export-csv').stdout).length,3);
  assert.equal(run('remove','--id','a').status,0);assert.equal(JSON.parse(await readFile(file,'utf8')).length,1);
});
