import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCSV,stringifyCSV} from '../src/csv.mjs';
import {parseVersion,compareVersions} from '../src/version.mjs';
import {createCatalog} from '../src/catalog.mjs';
import {searchRecords} from '../src/search.mjs';
import {planDependencies,reverseDependencies} from '../src/graph.mjs';
import {exportCSV,importCSV,exportNDJSON,importNDJSON} from '../src/transfer.mjs';
const record=(id,dependencies=[],extra={})=>({id,name:id,version:'1.0.0',tags:[],dependencies,...extra});

test('CSV preserves spaces, quotes, separators and multiline fields',()=>{
  const rows=[[' a ','comma,','quote"','CR\rLF\n'],['','','tail','']];
  assert.deepEqual(parseCSV(stringifyCSV(rows)+'\r\n'),rows);
  assert.deepEqual(parseCSV(''),[]);
  assert.deepEqual(parseCSV('\n'),[['']]);
  assert.deepEqual(parseCSV('a,\n'),[['a','']]);
  for(const text of ['"open','a"b','"closed"x']) assert.throws(()=>parseCSV(text));
});
test('semantic versions compare releases, prereleases and large numbers',()=>{
  const ordered=['1.0.0-alpha','1.0.0-alpha.2','1.0.0-alpha.10','1.0.0-beta','1.0.0','1.2.0','1.10.0'];
  for(let i=1;i<ordered.length;i++) {assert.equal(compareVersions(ordered[i-1],ordered[i]),-1);assert.equal(compareVersions(ordered[i],ordered[i-1]),1);}
  assert.deepEqual(parseVersion('0.1.2-foo-bar.0'),{major:0,minor:1,patch:2,prerelease:['foo-bar','0']});
  assert.equal(compareVersions('9007199254740992.0.0','9007199254740993.0.0'),-1);
  for(const v of ['1.2','01.2.3','1.2.3-01','1.2.3+build','1.2.3-',' 1.2.3',null]) assert.throws(()=>parseVersion(v));
});
test('catalog normalizes, isolates snapshots, and rolls back all writes',()=>{
  const seed=record(' b ',['a','a'],{name:' B ',tags:[' TOOLS ','tools','','Web']});
  const c=createCatalog([seed]);seed.tags.push('mutated');
  assert.deepEqual(c.get('b'),record('b',['a'],{name:'B',tags:['tools','web']}));
  const snapshot=c.list();snapshot[0].dependencies.push('mutated');assert.deepEqual(c.get('b').dependencies,['a']);
  const before=c.list();
  assert.throws(()=>c.applyBatch([{type:'update',id:'b',patch:{name:'new'}},{type:'add',record:record('b')}]),/duplicate/);
  assert.deepEqual(c.list(),before);
  assert.throws(()=>c.update('b',{id:'x'}));assert.throws(()=>c.update('missing',{name:'x'}));
  assert.throws(()=>c.add(record('x',[],{tags:null})));assert.deepEqual(c.list(),before);
  c.applyBatch([{type:'add',record:record('a')},{type:'remove',id:'b'}]);assert.deepEqual(c.list().map(r=>r.id),['a']);
  assert.equal(c.remove('absent'),false);
});
test('search combines filters, semantic bounds, pagination and stable ties',()=>{
  const records=[record('b',[],{name:'Same',tags:['web'],version:'1.10.0'}),record('a',[],{name:'Same',tags:['web','tools'],version:'1.2.0'}),record('c')];
  const before=structuredClone(records);
  assert.deepEqual(searchRecords(records,{sortBy:'name',order:'desc'}).items.map(r=>r.id),['c','a','b']);
  const result=searchRecords(records,{text:' SAME ',tags:[' WEB ','tools'],versionMin:'1.0.0',versionMax:'1.9.0',limit:1});
  assert.equal(result.total,1);assert.equal(result.items[0].id,'a');
  assert.deepEqual(searchRecords(records,{sortBy:'version',offset:1,limit:1}).items.map(r=>r.id),['a']);
  for(const query of [{offset:-1},{limit:0},{limit:101},{offset:1.5},{sortBy:'tags'},{order:'ASC'},{versionMin:'bad'}]) assert.throws(()=>searchRecords(records,query));
  assert.deepEqual(records,before);
});
test('graph follows stored order, deduplicates shared nodes and finds cycles/missing nodes',()=>{
  const records=[record('a',['c','b']),record('b',['d']),record('c',['d']),record('d')];
  assert.deepEqual(planDependencies(records,['a','b']),['d','c','b','a']);
  assert.deepEqual(reverseDependencies(records,'d'),['a','b','c']);
  assert.deepEqual(reverseDependencies(records,'a'),[]);
  assert.throws(()=>planDependencies([record('a',['missing'])],['a']),/missing/);
  assert.throws(()=>planDependencies([record('a',['b']),record('b',['a'])],['a']),/cycle.*a.*b/);
  assert.throws(()=>reverseDependencies(records,'missing'),/missing/);
});
test('CSV imports validate header and roll back invalid or duplicate later rows',()=>{
  const records=[record('a',[],{name:'A, "quoted"\nname',tags:['web']})];
  const csv=exportCSV(records),c=createCatalog();
  assert.deepEqual(importCSV(csv,c),records);
  const before=c.list();
  assert.throws(()=>importCSV(exportCSV([record('b'),record('a')]),c),/duplicate/);assert.deepEqual(c.list(),before);
  assert.throws(()=>importCSV('id,name,version,tags,dependencies\nx,X,bad,,',c));assert.deepEqual(c.list(),before);
  assert.throws(()=>importCSV('name,id,version,tags,dependencies',c),/header/);
});
test('NDJSON handles every UTF-8 byte boundary and final lines atomically',async()=>{
  const records=[record('a',[],{name:'雪🙂'}),record('b')];
  let text='';for await(const line of exportNDJSON(records)) text+=line;
  const bytes=Buffer.from('\n'+text.trimEnd());
  async function* chunks() {for(const byte of bytes) yield Buffer.from([byte]);}
  const c=createCatalog();assert.deepEqual(await importNDJSON(chunks(),c),records);
  const before=c.list();
  await assert.rejects(importNDJSON([JSON.stringify(record('x'))+'\n{bad'],c));assert.deepEqual(c.list(),before);
  await assert.rejects(importNDJSON([JSON.stringify(record('x'))+'\n'+JSON.stringify(record('a'))],c));assert.deepEqual(c.list(),before);
});
