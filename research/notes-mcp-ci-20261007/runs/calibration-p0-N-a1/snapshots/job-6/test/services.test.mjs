import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

function launch(file,args) {
  const child=spawn(process.execPath,[file,...args],{stdio:['pipe','pipe','pipe']});
  let errors='';child.stderr.on('data',chunk=>errors+=chunk);
  const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();
  return {child,lines,errors:()=>errors};
}
test('real MCP stdio framing, tools, resources, errors and shutdown', {timeout:15000}, async () => {
  const p=launch('src/mcp.mjs',['--db',':memory:']);
  let id=0;
  const rpc=async (method,params) => {
    const request={jsonrpc:'2.0',id:++id,method,params};
    p.child.stdin.write(JSON.stringify(request)+'\n');
    const response=JSON.parse((await p.lines.next()).value);
    assert.equal(response.id,id);return response;
  };
  const call=async (name,args={}) => (await rpc('tools/call',{name,arguments:args})).result;
  const value=r=>JSON.parse(r.content[0].text);
  try {
    assert.equal((await rpc('initialize',{})).result.protocolVersion,'2024-11-05');
    p.child.stdin.write('\n'+JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    assert.deepEqual((await rpc('ping')).result,{});
    const tools=(await rpc('tools/list')).result.tools;
    assert.equal(tools.length,8);assert.ok(tools.every(t=>t.inputSchema.type==='object'));
    const note=value(await call('notes_create',{text:' hello ',tags:[' Work ']}));
    assert.equal(note.text,'hello');
    assert.equal(value(await call('notes_get',{id:note.id})).id,note.id);
    assert.equal(value(await call('notes_update',{id:note.id,text:'updated'})).text,'updated');
    assert.equal((await call('notes_import',{notes:[{text:'valid'},{text:'bad',tags:[false]}]})).isError,true);
    assert.equal(value(await call('notes_list')).length,1);
    assert.deepEqual(value(await call('tags_list')),[{name:'work',count:1}]);
    assert.equal(value(await call('notes_export')).version,1);
    assert.equal(value(await call('notes_import',{notes:[{text:'second'}]})).length,1);
    const resource=(await rpc('resources/read',{uri:'notes://all'})).result.contents[0];
    assert.equal(JSON.parse(resource.text)[0].text,'second');
    assert.equal((await rpc('resources/list')).result.resources[0].uri,'notes://all');
    assert.equal((await rpc('resources/read',{uri:'missing'})).error.code,-32002);
    assert.equal((await rpc('unknown')).error.code,-32601);
    assert.equal((await call('notes_get',{id:'1'})).isError,true);
    p.child.stdin.write('{bad\n');
    assert.equal(JSON.parse((await p.lines.next()).value).error.code,-32700);
    assert.equal(value(await call('notes_delete',{id:note.id})),true);
    const exit=once(p.child,'exit');p.child.stdin.end();
    assert.equal((await exit)[0],0,p.errors());
  } finally {p.child.kill();}
});

test('dashboard and API workflows, escaping, pagination, import atomicity, persistence', {timeout:20000}, async () => {
  const dir=mkdtempSync('test/.services-');
  const db=join(dir,'notes.sqlite');
  const p=launch('src/web.mjs',['--db',db,'--port','0']);
  try {
    const {port}=JSON.parse((await p.lines.next()).value);
    const base=`http://127.0.0.1:${port}`;
    const request=(path,method='GET',body) => fetch(base+path,{method,redirect:'manual',...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    let r=await request('/api/notes','POST',{text:'<script>alert("x")</script> %_',tags:['<tag>']});
    assert.equal(r.status,201);const note=await r.json();
    const html=await (await request('/')).text();
    assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&lt;tag&gt;'));assert.ok(!html.includes('<script>'));
    assert.equal((await (await request('/api/notes?q=%25_')).json()).length,1);
    assert.equal((await request(`/notes/${note.id}/edit`)).status,200);
    assert.equal((await request(`/api/notes/${note.id}`,'PATCH',{text:'edited',tags:['work']})).status,200);
    assert.equal((await request('/api/import','POST',{notes:[{text:'ok'},{text:'bad',tags:[2]}]})).status,400);
    assert.equal((await (await request('/api/notes')).json()).length,1);
    r=await request('/api/import','POST',{notes:Array.from({length:22},(_,i)=>({text:'bulk '+i}))});assert.equal(r.status,201);
    assert.equal((await r.json()).length,22);
    const page2=await (await request('/?page=2')).text();assert.ok(page2.includes('Previous'));assert.ok(page2.includes('edited'));assert.ok(!page2.includes('bulk 21'));
    assert.equal((await (await request('/api/export')).json()).notes.length,23);
    assert.deepEqual(await (await request('/api/tags')).json(),[{name:'work',count:1}]);
    for (const path of ['/api/notes?limit=0','/api/notes?offset=-1','/?page=0']) assert.equal((await request(path)).status,400);
    assert.equal((await request('/missing')).status,404);
    assert.equal((await request('/api/notes/9999')).status,404);
    assert.equal((await request('/api/notes','POST',{text:''})).status,400);
    let formResponse=await fetch(base+'/notes',{method:'POST',redirect:'manual',body:new URLSearchParams({text:'form note',tags:'One, TWO'})});
    assert.equal(formResponse.status,303);assert.equal(formResponse.headers.get('location'),'/');
    const formNote=(await (await request('/api/notes')).json())[0];assert.deepEqual(formNote.tags,['one','two']);
    formResponse=await fetch(base+`/notes/${formNote.id}`,{method:'POST',redirect:'manual',body:new URLSearchParams({text:'form edited',tags:''})});
    assert.equal(formResponse.status,303);
    formResponse=await fetch(base+`/notes/${formNote.id}/delete`,{method:'POST',redirect:'manual'});assert.equal(formResponse.status,303);
    assert.equal((await request(`/api/notes/${note.id}`,'DELETE')).status,200);
    assert.equal((await request(`/api/notes/${note.id}`,'DELETE')).status,404);
    const exit=once(p.child,'exit');p.child.kill('SIGTERM');await exit;
    const m=launch('src/mcp.mjs',['--db',db]);
    try {
      m.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'notes_export',arguments:{}}})+'\n');
      const reply=JSON.parse((await m.lines.next()).value);
      assert.equal(JSON.parse(reply.result.content[0].text).notes.length,22);
      const done=once(m.child,'exit');m.child.stdin.end();await done;
    } finally {m.child.kill();}
  } finally {
    if (p.child.exitCode===null) {const exit=once(p.child,'exit');p.child.kill();await exit;}
    rmSync(dir,{recursive:true,force:true});
  }
});
