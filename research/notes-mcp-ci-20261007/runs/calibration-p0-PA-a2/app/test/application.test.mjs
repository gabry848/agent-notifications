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
import { importNotes, exportNotes } from '../src/import.mjs';

function temporary(t) {
  const dir=mkdtempSync(join(tmpdir(),'quick-notes-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  return join(dir,'nested','notes.sqlite');
}
test('storage validation, atomicity, filtering, persistence and foreign keys',t=>{
  const path=temporary(t);let s=openStore(path);
  const n=s.createNote(' Hello %_ WORLD ',[' Work ','work','Z']);
  assert.deepEqual(n.tags,['work','z']);
  assert.equal(s.listNotes({q:'%_ world',tag:' WORK '})[0].id,n.id);
  assert.equal(s.listNotes({q:'absent'}).length,0);
  assert.throws(()=>s.createNote('bad',['ok','']));
  assert.throws(()=>s.updateNote(n.id,{text:'changed',tags:[12]}));
  assert.equal(s.getNote(n.id).text,n.text);
  for(const record of [{text:'bad',tags:null},{text:'bad',tags:['']},{text:''}]) {
    assert.throws(()=>importNotes(s,[{text:'would be valid',tags:['new']},record]));
    assert.equal(s.listNotes().length,1);
  }
  const updated=s.updateNote(n.id,{tags:['other']});
  assert.equal(updated.createdAt,n.createdAt);
  assert.ok(updated.updatedAt>n.updatedAt);
  assert.deepEqual(s.listTags(),[{name:'other',count:1}]);
  assert.throws(()=>s.listNotes({limit:101}));
  assert.throws(()=>s.listNotes({offset:-1}));
  importNotes(s,[{text:'second'},{text:'third'}]);
  assert.deepEqual(exportNotes(s).notes.map(n=>n.text),['Hello %_ WORLD','second','third']);
  s.close();s=openStore(path);
  assert.equal(s.getNote(n.id).text,n.text);
  assert.equal(s.deleteNote(n.id),true);
  assert.equal(s.deleteNote(n.id),false);
  assert.equal(s.getNote(n.id),null);
  assert.deepEqual(s.listTags(),[]);
  s.close();
  const db=new DatabaseSync(path);
  assert.equal(db.prepare('SELECT count(*) AS n FROM note_tags').get().n,0);
  db.close();
});

function processFor(t,file,path,extra=[]) {
  const child=spawn(process.execPath,[file,'--db',path,...extra],{stdio:['pipe','pipe','pipe']});
  let errors='';child.stderr.on('data',data=>errors+=data);
  t.after(async()=>{if(child.exitCode===null && child.signalCode===null) {child.kill();await once(child,'exit');}});
  return {child,errors:()=>errors};
}
test('MCP newline transport, tool values, resources, errors and clean shutdown',async t=>{
  const {child}=processFor(t,'src/mcp.mjs',temporary(t));
  const pending=new Map();const received=[];
  createInterface({input:child.stdout}).on('line',line=>{const response=JSON.parse(line);received.push(response);pending.get(response.id)?.(response);pending.delete(response.id);});
  let id=0;
  const rpc=(method,params)=>new Promise(resolve=>{const requestId=++id;pending.set(requestId,resolve);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:requestId,method,params})+'\n');});
  const tool=async(name,a={})=>(await rpc('tools/call',{name,arguments:a})).result;
  assert.equal((await rpc('initialize',{})).result.protocolVersion,'2024-11-05');
  child.stdin.write('\n'+JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  assert.equal((await rpc('tools/list')).result.tools.length,8);
  const note=JSON.parse((await tool('notes_create',{text:'one',tags:['X']})).content[0].text);
  assert.equal(note.text,'one');
  assert.equal((await tool('notes_import',{notes:[{text:'two'},{text:'three',tags:[null]}]})).isError,true);
  const resource=JSON.parse((await rpc('resources/read',{uri:'notes://all'})).result.contents[0].text);
  assert.deepEqual(resource,[note]);
  assert.equal((await rpc('resources/read',{uri:'unknown'})).error.code,-32002);
  assert.equal((await rpc('unsupported')).error.code,-32601);
  const malformed=new Promise(resolve=>pending.set(null,resolve));child.stdin.write('{bad\n');
  assert.equal((await malformed).error.code,-32700);
  child.stdin.end();assert.equal((await once(child,'exit'))[0],0);
  assert.equal(received.filter(r=>r.id===null).length,1);
});

test('web dashboard, API, forms, escaping, pagination and atomic import',async t=>{
  const {child}=processFor(t,'src/web.mjs',temporary(t),['--port','0']);
  const lines=createInterface({input:child.stdout});
  const [line]=await once(lines,'line');const base=`http://127.0.0.1:${JSON.parse(line).port}`;
  const request=(path,method='GET',value)=>fetch(base+path,{method,redirect:'manual',headers:value?{'Content-Type':'application/json'}:undefined,body:value?JSON.stringify(value):undefined});
  const n=await (await request('/api/notes','POST',{text:'<script>alert("x")</script> %_',tags:['WEB']})).json();
  assert.equal((await request('/api/notes/'+n.id)).status,200);
  const html=await (await request('/?q='+encodeURIComponent('%_'))).text();
  assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
  assert.ok((await (await request(`/notes/${n.id}/edit`)).text()).includes('textarea'));
  const invalid=await request('/api/import','POST',{notes:[{text:'good'},{text:'bad',tags:[false]}]});
  assert.equal(invalid.status,400);
  assert.equal((await (await request('/api/notes')).json()).length,1);
  assert.equal((await request('/api/notes/'+n.id,'PATCH',{text:'new',tags:['a']})).status,200);
  assert.deepEqual(await (await request('/api/tags')).json(),[{name:'a',count:1}]);
  await request('/api/import','POST',{notes:Array.from({length:22},(_,i)=>({text:`note ${i}`}))});
  assert.equal((await (await request('/api/notes?limit=20&offset=20')).json()).length,3);
  assert.ok((await (await request('/?page=2')).text()).includes('Previous'));
  const form=await fetch(base+'/notes',{method:'POST',redirect:'manual',body:new URLSearchParams({text:'form note',tags:' A, b '})});
  assert.equal(form.status,303);assert.equal(form.headers.get('location'),'/');
  assert.equal((await request('/api/notes?limit=0')).status,400);
  assert.equal((await request('/api/notes/'+n.id,'DELETE')).status,200);
  assert.equal((await request('/api/notes/'+n.id)).status,404);
  assert.equal((await request('/missing')).status,404);
});
