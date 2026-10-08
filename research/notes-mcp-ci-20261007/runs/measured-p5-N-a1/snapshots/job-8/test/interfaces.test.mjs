import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';

function launch(file,args) {
  const child=spawn(process.execPath,[file,...args],{stdio:['pipe','pipe','pipe']});
  const lines=createInterface({input:child.stdout});
  const queued=[],waiters=[];
  lines.on('line',line=>{const value=JSON.parse(line);if(waiters.length) waiters.shift()(value);else queued.push(value);});
  let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
  return {child,read:()=>queued.length?Promise.resolve(queued.shift()):new Promise(resolve=>waiters.push(resolve)),stderr:()=>stderr};
}
const value = response => JSON.parse(response.result.content[0].text);

test('real MCP transport, error handling, all tools, resource shape and restart persistence',{timeout:15000},async()=>{
  const dir=mkdtempSync(join(process.cwd(),'test/.mcp-'));const db=join(dir,'notes.sqlite');
  const p=launch('src/mcp.mjs',['--db',db]);
  let id=0;
  const rpc=async(method,params)=>{p.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:++id,method,params})+'\n');const r=await p.read();assert.equal(r.id,id);return r;};
  const tool=async(name,args={})=>rpc('tools/call',{name,arguments:args});
  try {
    p.child.stdin.write('\n{bad json}\n');assert.equal((await p.read()).error.code,-32700);
    assert.equal((await rpc('initialize',{})).result.protocolVersion,'2024-11-05');
    p.child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    assert.deepEqual((await rpc('ping')).result,{});
    const tools=(await rpc('tools/list')).result.tools;assert.equal(tools.length,8);assert.ok(tools.every(t=>t.inputSchema.type==='object'));
    const n=value(await tool('notes_create',{text:' first ',tags:[' Work ']}));
    assert.deepEqual(value(await tool('notes_get',{id:n.id})),n);
    assert.equal((await tool('notes_import',{notes:[{text:'valid'},{text:'invalid',tags:[null]}]})).result.isError,true);
    assert.equal(value(await tool('notes_list')).length,1);
    const imported=value(await tool('notes_import',{notes:[{text:'second'}]}));assert.equal(imported.length,1);
    assert.deepEqual(value(await tool('notes_export')),{version:1,notes:[{text:'first',tags:['work']},{text:'second',tags:[]}]});
    assert.deepEqual(value(await tool('tags_list')),[{name:'work',count:1}]);
    const updated=value(await tool('notes_update',{id:n.id,text:'edited',tags:[]}));assert.equal(updated.createdAt,n.createdAt);
    assert.equal(value(await tool('notes_get',{id:999})),null);
    assert.equal(value(await tool('notes_update',{id:999,text:'missing'})),null);
    const resource=(await rpc('resources/read',{uri:'notes://all'})).result.contents[0];
    const all=JSON.parse(resource.text);assert.equal(all[0].id,imported[0].id);assert.equal(all[1].text,'edited');assert.equal(resource.mimeType,'application/json');
    assert.equal((await rpc('resources/list')).result.resources[0].uri,'notes://all');
    assert.equal((await rpc('resources/read',{uri:'unknown'})).error.code,-32002);
    assert.equal((await rpc('unknown')).error.code,-32601);
    assert.equal(value(await tool('notes_delete',{id:imported[0].id})),true);
    assert.equal((await tool('notes_get',{id:'1'})).result.isError,true);
    const exit=once(p.child,'exit');p.child.stdin.end();assert.equal((await exit)[0],0);
    const reopened=launch('src/mcp.mjs',['--db',db]);
    reopened.child.stdin.end('{"jsonrpc":"2.0","id":"restart","method":"tools/call","params":{"name":"notes_list","arguments":{}}}\n');
    const r=await reopened.read();assert.equal(r.id,'restart');assert.equal(value(r)[0].text,'edited');
    if(reopened.child.exitCode===null) await once(reopened.child,'exit');
  } finally {if(p.child.exitCode===null)p.child.kill();rmSync(dir,{recursive:true,force:true});}
});

test('web API, dashboard forms, escaping, filters, pagination and validation',{timeout:15000},async()=>{
  const dir=mkdtempSync(join(process.cwd(),'test/.web-'));const p=launch('src/web.mjs',['--db',join(dir,'notes.sqlite'),'--port','0']);
  try {
    const {port}=await p.read();const base=`http://127.0.0.1:${port}`;
    const req=(path,method='GET',data)=>fetch(base+path,{method,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
    const payload={text:'<script>alert("x")</script> 50%_',tags:['<b>','Work']};
    const create=await req('/api/notes','POST',payload);assert.equal(create.status,201);const n=await create.json();
    assert.deepEqual(await (await req(`/api/notes/${n.id}`)).json(),n);
    const page=await (await req('/?q='+encodeURIComponent('<script>'))).text();
    assert.ok(page.includes('&lt;script&gt;'));assert.ok(!page.includes('<script>'));assert.ok(page.includes('&lt;b&gt;'));
    assert.equal((await (await req('/api/notes?q=%25_&tag=WORK')).json()).length,1);
    assert.equal((await req('/api/notes?limit=0')).status,400);
    assert.equal((await req('/api/import','POST',{notes:[{text:'valid'},{text:'bad',tags:[null]}]})).status,400);
    assert.equal((await (await req('/api/notes')).json()).length,1);
    assert.equal((await req(`/api/notes/${n.id}`,'PATCH',{text:'invalid',tags:['']})).status,400);
    assert.deepEqual(await (await req(`/api/notes/${n.id}`)).json(),n);
    const edit=await (await req(`/notes/${n.id}/edit`)).text();assert.ok(edit.includes('&lt;script&gt;'));assert.ok(edit.includes(`action="/notes/${n.id}"`));
    const formPost=(path,fields)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields),redirect:'manual'});
    assert.equal((await formPost('/notes',{text:'  ',tags:'work'})).status,400);
    assert.equal((await formPost(`/notes/${n.id}`,{text:'edited',tags:' A, a, B '})).status,303);
    assert.deepEqual((await (await req(`/api/notes/${n.id}`)).json()).tags,['a','b']);
    assert.equal((await formPost('/notes',{text:'from form',tags:''})).headers.get('location'),'/');
    assert.equal((await req('/api/import','POST',{notes:Array.from({length:24},(_,i)=>({text:`number ${i}`}))})).status,201);
    const second=await (await req('/?page=2')).text();assert.ok(second.includes('Previous'));assert.ok(second.includes('Page 2'));assert.ok(!second.includes('number 23'));
    assert.equal((await (await req('/api/export')).json()).notes[0].text,'edited');
    assert.deepEqual(await (await req('/api/tags')).json(),[{name:'a',count:1},{name:'b',count:1}]);
    assert.equal((await formPost(`/notes/${n.id}/delete`,{})).status,303);
    assert.equal((await req(`/api/notes/${n.id}`)).status,404);
    const remaining=await (await req('/api/notes')).json();assert.equal(await (await req(`/api/notes/${remaining[0].id}`,'DELETE')).json(),true);
    assert.equal((await req('/missing')).status,404);assert.equal((await req('/notes/999/edit')).status,404);
    assert.equal((await req('/api/notes','POST',{text:'ok',tags:null})).status,400);
  } finally {const exit=once(p.child,'exit');p.child.kill('SIGTERM');await exit;rmSync(dir,{recursive:true,force:true});}
});
