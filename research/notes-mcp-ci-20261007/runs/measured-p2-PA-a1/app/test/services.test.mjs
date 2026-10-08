import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

function launch(file,args) {
  const child = spawn(process.execPath,[file,...args],{stdio:['pipe','pipe','pipe']});
  let stderr = ''; child.stderr.on('data', b => stderr += b);
  const lines = [], waiters = [];
  const input = createInterface({input:child.stdout});
  input.on('line',line => {const value = JSON.parse(line); if (waiters.length) waiters.shift()(value); else lines.push(value);});
  return {child, next:() => lines.length ? Promise.resolve(lines.shift()) : new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error(`Service timeout: ${stderr}`)),5000);
    waiters.push(value => {clearTimeout(timer);resolve(value);});
  })};
}

test('real MCP stdio and sequential web process share persistent notes', async () => {
  const dir = mkdtempSync(join(process.cwd(),'.test-services-')), db = join(dir,'notes.sqlite');
  const mcp = launch('src/mcp.mjs',['--db',db]);
  let web;
  let seq = 0;
  const rpc = async (method,params) => {
    const id = ++seq;
    mcp.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
    const message = await mcp.next(); assert.equal(message.id,id); return message;
  };
  const tool = async (name,args = {}) => {
    const {result} = await rpc('tools/call',{name,arguments:args});
    assert.ok(!result.isError, result.content[0].text); return JSON.parse(result.content[0].text);
  };
  try {
    assert.equal((await rpc('initialize',{})).result.protocolVersion,'2024-11-05');
    mcp.child.stdin.write('\n'+JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    assert.deepEqual((await rpc('ping')).result,{});
    assert.equal((await rpc('tools/list')).result.tools.length,8);
    const n = await tool('notes_create',{text:'<script>alert("x")</script> %_',tags:[' Work ']});
    assert.equal((await tool('notes_get',{id:n.id})).text,n.text);
    assert.equal((await tool('notes_list',{q:'%_'})).length,1);
    const fail = await rpc('tools/call',{name:'notes_import',arguments:{notes:[{text:'valid'},{text:'bad',tags:[null]}]}});
    assert.equal(fail.result.isError,true); assert.equal((await tool('notes_list')).length,1);
    const resource = (await rpc('resources/read',{uri:'notes://all'})).result.contents[0];
    assert.deepEqual(JSON.parse(resource.text),[n]);
    assert.equal((await rpc('resources/read',{uri:'bad'})).error.code,-32002);
    assert.equal((await rpc('unsupported')).error.code,-32601);
    mcp.child.stdin.write('not JSON\n'); assert.equal((await mcp.next()).error.code,-32700);
    mcp.child.stdin.end(); assert.equal((await once(mcp.child,'exit'))[0],0);

    web = launch('src/web.mjs',['--db',db,'--port','0']);
    const {port} = await web.next(); const root = `http://127.0.0.1:${port}`;
    const request = (path,method = 'GET',data) => fetch(root+path,{method,headers:data ? {'Content-Type':'application/json'} : {},body:data ? JSON.stringify(data) : undefined});
    assert.equal((await (await request('/api/notes')).json()).length,1);
    let html = await (await request('/?q=%25_&tag=')).text();
    assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>'));
    assert.equal((await request('/api/import','POST',{notes:[{text:'ok'},{text:'bad',tags:['']}]})).status,400);
    assert.equal((await (await request('/api/notes')).json()).length,1);
    assert.equal((await request('/api/notes?limit=0')).status,400);
    assert.equal((await request('/api/notes/999')).status,404);
    const patched = await (await request(`/api/notes/${n.id}`,'PATCH',{text:'edited',tags:['New']})).json();
    assert.deepEqual(patched.tags,['new']); assert.equal(patched.createdAt,n.createdAt);
    const imported = await (await request('/api/import','POST',{notes:Array.from({length:22},(_,i) => ({text:`page-note-${i}`}))})).json();
    assert.equal(imported.length,22);
    html = await (await request('/?page=2')).text(); assert.ok(html.includes('Previous')); assert.ok(html.includes('edited'));
    const formPost = (path,data) => fetch(root+path,{method:'POST',redirect:'manual',body:new URLSearchParams(data)});
    const created = await formPost('/notes',{text:'form note',tags:' a, B '});
    assert.equal(created.status,303); assert.equal(created.headers.get('location'),'/');
    const notes = await (await request('/api/notes')).json(); const formNote = notes[0];
    assert.deepEqual(formNote.tags,['a','b']);
    assert.ok((await (await request(`/notes/${formNote.id}/edit`)).text()).includes('form note'));
    assert.equal((await formPost(`/notes/${formNote.id}`,{text:'updated form',tags:''})).status,303);
    assert.equal((await formPost(`/notes/${formNote.id}/delete`,{})).status,303);
    assert.equal((await request(`/api/notes/${n.id}`,'DELETE')).status,200);
    assert.equal((await request(`/api/notes/${n.id}`)).status,404);
    assert.equal((await (await request('/api/export')).json()).notes.length,22);
    assert.deepEqual(await (await request('/api/tags')).json(),[]);
  } finally {
    if (mcp.child.exitCode === null) mcp.child.kill();
    if (web && web.child.exitCode === null) {web.child.kill(); await once(web.child,'exit');}
    rmSync(dir,{recursive:true,force:true});
  }
});
