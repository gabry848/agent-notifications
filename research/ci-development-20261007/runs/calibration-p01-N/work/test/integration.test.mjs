import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createCatalog} from '../src/catalog.mjs';
import {createServer} from '../src/server.mjs';
const record=(id)=>({id,name:'雪 '+id,version:'1.0.0',tags:['web'],dependencies:[]});

test('HTTP CRUD, search, transfer, URL decoding and request errors work together',async t=>{
  const c=createCatalog(),server=createServer(c);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const request=(path,method='GET',body)=>fetch(base+path,{method,body});
  assert.deepEqual(await (await request('/health')).json(),{ok:true});
  let response=await request('/records','POST',JSON.stringify(record('a/b')));assert.equal(response.status,201);
  assert.equal((await (await request('/records/a%2Fb')).json()).id,'a/b');
  assert.equal((await request('/records','POST',JSON.stringify(record('a/b')))).status,409);
  response=await request('/records/a%2Fb','PATCH',JSON.stringify({name:'Renamed'}));assert.equal((await response.json()).name,'Renamed');
  assert.equal((await (await request('/records?text=renamed&tags=WEB&limit=1')).json()).total,1);
  assert.deepEqual(await (await request('/plan?ids=a%2Fb')).json(),{ids:['a/b']});
  const csv=await (await request('/export.csv')).text();
  response=await request('/export.ndjson');assert.match(response.headers.get('content-type'),/application\/x-ndjson/);
  const ndjson=await response.text();assert.equal(JSON.parse(ndjson).id,'a/b');
  assert.equal((await request('/records/a%2Fb','DELETE')).status,204);
  assert.equal((await request('/records/a%2Fb')).status,404);
  assert.deepEqual(await (await request('/import.csv','POST',csv)).json(),{added:1});
  await request('/records/a%2Fb','DELETE');
  assert.deepEqual(await (await request('/import.ndjson','POST',ndjson)).json(),{added:1});
  const before=c.list();
  response=await request('/import.ndjson','POST',JSON.stringify(record('b'))+'\nBAD');assert.equal(response.status,400);assert.deepEqual(c.list(),before);
  for(const [path,method,body,status] of [
    ['/no-route','GET',undefined,404],['/records?limit=0','GET',undefined,400],['/records/%ZZ','GET',undefined,400],
    ['/records','POST','{bad',400],['/records','POST','x'.repeat(1024*1024+1),413]
  ]) {response=await request(path,method,body);assert.equal(response.status,status);assert.equal(typeof (await response.json()).error,'string');}
  assert.deepEqual(c.list(),before);assert.equal((await request('/health')).status,200);
});

test('CLI persists validated writes atomically and leaves invalid files untouched',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'catalog-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=join(dir,'catalog.json');
  const run=(...args)=>spawnSync(process.execPath,['src/cli.mjs',...args],{encoding:'utf8'});
  let result=run('list','--file',file);assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).total,0);
  result=run('add','--file',file,'--record',JSON.stringify(record('a')));assert.equal(result.status,0);
  const before=await readFile(file,'utf8');
  result=run('add','--file',file,'--record',JSON.stringify(record('a')));assert.notEqual(result.status,0);assert.match(result.stderr,/duplicate/);assert.equal(await readFile(file,'utf8'),before);
  result=run('list','--file',file,'--text','雪','--tags','WEB');assert.equal(JSON.parse(result.stdout).total,1);
  result=run('plan','--file',file,'--ids','a');assert.deepEqual(JSON.parse(result.stdout),{ids:['a']});
  result=run('export-csv','--file',file);assert.match(result.stdout,/^id,name,version,tags,dependencies/);
  const input=join(dir,'input.csv');await writeFile(input,'id,name,version,tags,dependencies\nb,B,1.0.0,,\nc,C,bad,,');
  result=run('import-csv','--file',file,'--input',input);assert.notEqual(result.status,0);assert.equal(await readFile(file,'utf8'),before);
  await writeFile(input,'id,name,version,tags,dependencies\nb,B,1.0.0,,');
  result=run('import-csv','--file',file,'--input',input);assert.deepEqual(JSON.parse(result.stdout),{added:1});
  result=run('remove','--file',file,'--id','a');assert.equal(JSON.parse(result.stdout),true);
  assert.deepEqual((await readdir(dir)).sort(),['catalog.json','input.csv']);
  assert.notEqual(run('list').status,0);
  await writeFile(file,'not json');result=run('add','--file',file,'--record',JSON.stringify(record('z')));assert.notEqual(result.status,0);assert.equal(await readFile(file,'utf8'),'not json');
});
