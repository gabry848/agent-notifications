import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {parseCSV,stringifyCSV} from '../src/csv.mjs';
import {parseVersion,compareVersions} from '../src/version.mjs';
import {createCatalog} from '../src/catalog.mjs';
import {searchRecords} from '../src/search.mjs';
import {planDependencies,reverseDependencies} from '../src/graph.mjs';
import {exportCSV,importCSV,exportNDJSON,importNDJSON} from '../src/transfer.mjs';
import {createServer} from '../src/server.mjs';
const record=(id,extra={})=>({id,name:id.toUpperCase(),version:'1.0.0',tags:[],dependencies:[],...extra});

test('CSV preserves whitespace, empty fields, escaped quotes and embedded separators',()=>{
  const rows=[[' a ', '', '"hello",\r\nworld'],['','tail','']];
  assert.deepEqual(parseCSV(stringifyCSV(rows)+'\r\n'),rows);
  assert.deepEqual(parseCSV(''),[]);
  assert.deepEqual(parseCSV('\n'),[['']]);
  for(const invalid of ['"open','un"quoted','"closed"tail']) assert.throws(()=>parseCSV(invalid));
});
test('semantic versions compare prereleases and arbitrarily large integer text',()=>{
  const order=['1.0.0-alpha','1.0.0-alpha.2','1.0.0-alpha.10','1.0.0-beta','1.0.0','2.0.0'];
  for(let i=1;i<order.length;i++) assert.equal(compareVersions(order[i-1],order[i]),-1);
  assert.equal(compareVersions('9007199254740992.0.0','9007199254740993.0.0'),-1);
  for(const invalid of ['01.0.0','1.0','1.0.0-01','1.0.0+build','1.0.0-','1.0.0-α']) assert.throws(()=>parseVersion(invalid));
});
test('catalog snapshots and failed batches never leak writes',()=>{
  const seed=record(' a ',{name:' A ',tags:[' WEB ','web','', 'Tools'],dependencies:['other','other']});
  const c=createCatalog([seed]);seed.tags.push('leak');
  assert.deepEqual(c.get('a'),record('a',{tags:['tools','web'],dependencies:['other']}));
  c.get('a').dependencies.push('leak');c.list()[0].tags.push('leak');
  const before=c.list();
  assert.throws(()=>c.applyBatch([{type:'update',id:'a',patch:{name:'changed'}},{type:'add',record:record('a')}]));
  assert.deepEqual(c.list(),before);
  assert.throws(()=>c.update('a',{id:'b'}));
  assert.throws(()=>createCatalog([record('a'),record('a')]));
  assert.throws(()=>c.add(record('b',{tags:[1]})));
  assert.deepEqual(c.list(),before);
});
test('search filters, semantic sorting, stable id ties and isolated output',()=>{
  const input=[record('c',{name:'Same',version:'10.0.0',tags:['web']}),record('b',{name:'Same',version:'2.0.0',tags:['web']}),record('a',{name:'Same',version:'2.0.0',tags:['web','tools']})];
  const before=structuredClone(input);
  assert.deepEqual(searchRecords(input,{sortBy:'version',order:'desc'}).items.map(r=>r.id),['c','a','b']);
  const found=searchRecords(input,{text:' SAME ',tags:[' WEB ','tools'],versionMin:'2.0.0',versionMax:'2.0.0'});
  assert.equal(found.total,1);found.items[0].tags.push('leak');assert.deepEqual(input,before);
  for(const query of [{limit:0},{offset:0.5},{sortBy:'unknown'},{order:'DESC'},{versionMin:'bad'}]) assert.throws(()=>searchRecords(input,query));
});
test('graph obeys stored traversal order, diagnoses cycles/missing nodes, and handles reverse cycles',()=>{
  const records=[record('a',{dependencies:['c','b']}),record('b',{dependencies:['d']}),record('c',{dependencies:['d']}),record('d')];
  assert.deepEqual(planDependencies(records,['a','b']),['d','c','b','a']);
  assert.deepEqual(reverseDependencies(records,'d'),['a','b','c']);
  assert.throws(()=>planDependencies(records,['missing']),/missing/);
  const cycle=[record('a',{dependencies:['b']}),record('b',{dependencies:['a']})];
  assert.throws(()=>planDependencies(cycle,['a']),/cycle.*a.*b/);
  assert.deepEqual(reverseDependencies(cycle,'a'),['b']);
});
test('CSV and NDJSON imports are atomic, including split UTF-8 and final unterminated line',async()=>{
  const records=[record('é',{name:'你好, "world"\nnext',tags:['web']}),record('b',{dependencies:['é']})];
  const c=createCatalog();assert.equal(importCSV(exportCSV(records),c).length,2);
  assert.deepEqual(c.list(),createCatalog(records).list());
  const lines=[];for await(const line of exportNDJSON(records)) lines.push(line);
  const data=Buffer.from('\n'+lines.join('').trimEnd());
  async function* chunks() {for(const byte of data) yield Buffer.from([byte]);}
  const other=createCatalog();await importNDJSON(chunks(),other);assert.deepEqual(other.list(),c.list());
  const before=c.list();
  await assert.rejects(importNDJSON([JSON.stringify(record('new'))+'\n{bad}'],c));
  await assert.rejects(importNDJSON([JSON.stringify(record('new'))+'\n'+JSON.stringify(record('bad',{version:'bad'}))],c));
  assert.throws(()=>importCSV(exportCSV([record('new'),record('é')]),c));
  assert.deepEqual(c.list(),before);
});
test('HTTP CRUD, filtering, encoded ids, transactional errors and oversize recovery',async t=>{
  const c=createCatalog(),server=createServer(c);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,method='GET',data)=>fetch(base+path,{method,body:data});
  assert.deepEqual(await (await request('/health')).json(),{ok:true});
  assert.equal((await request('/records','POST',JSON.stringify(record('a/b',{tags:['web']})))).status,201);
  assert.equal((await request('/records','POST',JSON.stringify(record('a/b')))).status,409);
  assert.equal((await (await request('/records/a%2Fb')).json()).id,'a/b');
  assert.equal((await request('/records/a%2Fb','PATCH',JSON.stringify({name:'Updated'}))).status,200);
  assert.equal((await (await request('/records?text=updated&tags=web')).json()).total,1);
  assert.equal((await request('/records?offset=')).status,400);
  assert.equal((await request('/import.ndjson','POST',JSON.stringify(record('new'))+'\n{bad}')).status,400);
  assert.equal(c.get('new'),null);
  assert.equal((await request('/records','POST','x'.repeat(1024*1024+1))).status,413);
  assert.equal((await request('/health')).status,200);
  assert.equal((await request('/records/a%2Fb','DELETE')).status,204);
  assert.equal((await request('/records/a%2Fb')).status,404);
  assert.equal((await request('/unknown')).status,404);
});
test('CLI persists validated data atomically and leaves files untouched on failures',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'catalog-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=join(dir,'data.json');
  const run=(...args)=>spawnSync(process.execPath,['src/cli.mjs',...args],{encoding:'utf8'});
  assert.notEqual(run('list').status,0);
  let result=run('add','--file',file,'--record',JSON.stringify(record('a')));assert.equal(result.status,0,result.stderr);
  const before=await readFile(file,'utf8');
  result=run('add','--file',file,'--record',JSON.stringify(record('a')));assert.notEqual(result.status,0);assert.ok(result.stderr);
  const input=join(dir,'bad.csv');await writeFile(input,exportCSV([record('b'),record('a')]));
  assert.notEqual(run('import-csv','--file',file,'--input',input).status,0);
  assert.equal(await readFile(file,'utf8'),before);
  assert.deepEqual((await readdir(dir)).sort(),['bad.csv','data.json']);
  assert.equal(JSON.parse(run('list','--file',file,'--text',' A ').stdout).total,1);
  assert.deepEqual(JSON.parse(run('plan','--file',file,'--ids','a').stdout),{ids:['a']});
  assert.deepEqual(parseCSV(run('export-csv','--file',file).stdout)[0],['id','name','version','tags','dependencies']);
});
