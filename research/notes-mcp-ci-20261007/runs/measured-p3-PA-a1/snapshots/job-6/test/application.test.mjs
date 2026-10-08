import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/store.mjs';
import { importNotes } from '../src/import.mjs';
import { exportNotes } from '../src/service.mjs';

function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'quick-notes-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  return join(dir,'nested','notes.sqlite');
}
test('persistent storage, literal search, atomic validation and foreign keys',t=>{
  const path=fixture(t);let store=openStore(path);
  const first=store.createNote('  100%_ <hello>  ',[' Work ','work','Z']);
  assert.equal(first.text,'100%_ <hello>');assert.deepEqual(first.tags,['work','z']);
  const second=store.createNote('other',['work']);
  assert.deepEqual(store.listNotes({q:'%_'}).map(n=>n.id),[first.id]);
  assert.deepEqual(store.listNotes({tag:' WORK ',limit:1,offset:1}),[first]);
  assert.throws(()=>store.createNote('bad',['ok',null]));
  assert.throws(()=>store.updateNote(first.id,{text:'changed',tags:['']}));
  assert.deepEqual(store.getNote(first.id),first);
  for (const record of [{text:' '},{text:'valid',tags:[3]},{text:'valid',tags:null}]) {
    assert.throws(()=>importNotes(store,[{text:'would leak'},record]));
    assert.equal(store.listNotes().length,2);
  }
  assert.throws(()=>store.listNotes({limit:101}));
  assert.throws(()=>store.listNotes({offset:-1}));
  const updated=store.updateNote(first.id,{tags:['new']});
  assert.equal(updated.createdAt,first.createdAt);assert.notEqual(updated.updatedAt,first.updatedAt);
  assert.deepEqual(updated.tags,['new']);
  assert.deepEqual(exportNotes(store).notes.map(n=>n.text),[first.text,second.text]);
  assert.equal(store.deleteNote(second.id),true);assert.equal(store.deleteNote(second.id),false);
  assert.deepEqual(store.listTags(),[{name:'new',count:1}]);
  store.close();store=openStore(path);assert.deepEqual(store.getNote(first.id),updated);store.close();
  const db=new DatabaseSync(path);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM note_tags WHERE note_id=?').get(second.id).n,0);db.close();
});

function launch(t,script,path,extra=[]) {
  const child=spawn(process.execPath,[script,'--db',path,...extra],{stdio:['pipe','pipe','pipe']});
  let stderr='';child.stderr.on('data',c=>stderr+=c);
  const lines=createInterface({input:child.stdout});
  const pending=[],buffer=[];
  lines.on('line',line=>{const value=JSON.parse(line);if(pending.length)pending.shift()(value);else buffer.push(value);});
  t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}lines.close();});
  return {child,next:()=>buffer.length ? Promise.resolve(buffer.shift()) : new Promise(resolve=>pending.push(resolve)),stderr:()=>stderr};
}
test('MCP newline protocol, tool values, resource and import rollback', {timeout:10000},async t=>{
  const app=launch(t,'src/mcp.mjs',fixture(t));let id=0;
  const rpc=async(method,params)=>{app.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:++id,method,params})+'\n');const response=await app.next();assert.equal(response.id,id);return response;};
  assert.equal((await rpc('initialize',{})).result.protocolVersion,'2024-11-05');
  app.child.stdin.write('\n'+JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  assert.equal((await rpc('tools/list')).result.tools.length,8);
  const call=async(name,args={})=>(await rpc('tools/call',{name,arguments:args})).result;
  const created=JSON.parse((await call('notes_create',{text:'hello',tags:['A']})).content[0].text);
  assert.deepEqual(created.tags,['a']);
  assert.equal((await call('notes_import',{notes:[{text:'no leak'},{text:'bad',tags:[null]}]})).isError,true);
  const resource=await rpc('resources/read',{uri:'notes://all'});
  assert.deepEqual(JSON.parse(resource.result.contents[0].text),[created]);
  assert.equal((await rpc('resources/read',{uri:'unknown'})).error.code,-32002);
  assert.equal((await rpc('unsupported')).error.code,-32601);
  app.child.stdin.write('{broken\n');assert.equal((await app.next()).error.code,-32700);
  app.child.stdin.end();const [code]=await once(app.child,'exit');assert.equal(code,0,app.stderr());
});
test('web API, dashboard escaping, forms and pagination', {timeout:10000},async t=>{
  const app=launch(t,'src/web.mjs',fixture(t),['--port','0']);
  const {port}=await app.next();const base=`http://127.0.0.1:${port}`;
  const request=(path,method='GET',data)=>fetch(base+path,{method,headers:data ? {'Content-Type':'application/json'} : {},body:data ? JSON.stringify(data) : undefined});
  let response=await request('/api/notes','POST',{text:'<script>alert("x")</script>',tags:['<tag>']});
  assert.equal(response.status,201);const note=await response.json();
  const dashboard=await (await request('/?q=%3Cscript%3E')).text();
  assert.ok(dashboard.includes('&lt;script&gt;'));assert.ok(!dashboard.includes('<script>'));
  assert.ok((await (await request(`/notes/${note.id}/edit`)).text()).includes('Save'));
  assert.equal((await request('/api/import','POST',{notes:[{text:'valid'},{text:'bad',tags:[false]}]})).status,400);
  assert.equal((await (await request('/api/notes')).json()).length,1);
  assert.equal((await request('/api/notes?limit=no')).status,400);
  response=await fetch(base+'/notes',{method:'POST',body:new URLSearchParams({text:'form note',tags:'A, B'}),redirect:'manual'});
  assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/');
  await request('/api/import','POST',{notes:Array.from({length:21},(_,i)=>({text:`page ${i}`}))});
  assert.ok((await (await request('/?page=2')).text()).includes('Previous'));
  const exported=await (await request('/api/export')).json();assert.equal(exported.version,1);assert.equal(exported.notes.length,23);
  response=await request(`/api/notes/${note.id}`,'PATCH',{text:'updated',tags:[]});assert.equal((await response.json()).text,'updated');
  assert.equal(await (await request(`/api/notes/${note.id}`,'DELETE')).json(),true);
  assert.equal((await request(`/api/notes/${note.id}`)).status,404);
  assert.equal((await request('/missing')).status,404);
});
