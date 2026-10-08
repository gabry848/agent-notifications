import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const rpc=(id,method,params={})=>({jsonrpc:'2.0',id,method,params});
const value=result=>JSON.parse(result.content[0].text);

test('real MCP stdio protocol, tools, errors, imports, and resources',()=>{
  const requests=[
    rpc('init','initialize'),{jsonrpc:'2.0',method:'notifications/initialized'},rpc(1,'ping'),rpc(2,'tools/list'),
    rpc(3,'tools/call',{name:'notes_create',arguments:{text:' One ',tags:['Work']}}),
    rpc(4,'tools/call',{name:'notes_import',arguments:{notes:[{text:'two'},{text:'bad',tags:[null]}]}}),
    rpc(5,'tools/call',{name:'notes_list'}),rpc(6,'resources/list'),rpc(7,'resources/read',{uri:'notes://all'}),
    rpc(8,'tools/call',{name:'notes_update',arguments:{id:1,text:'changed',tags:['Other']}}),
    rpc(9,'tools/call',{name:'notes_get',arguments:{id:1}}),rpc(10,'tools/call',{name:'tags_list'}),
    rpc(11,'tools/call',{name:'notes_export'}),rpc(12,'tools/call',{name:'notes_import',arguments:{notes:[{text:'two'}]}}),
    rpc(13,'tools/call',{name:'notes_delete',arguments:{id:1}}),rpc(14,'tools/call',{name:'notes_get',arguments:{id:1}}),
    rpc(15,'not-supported'),rpc(16,'resources/read',{uri:'unknown'}),rpc(17,'tools/call',{name:'notes_list',arguments:{limit:0}})
  ];
  const run=spawnSync(process.execPath,['src/mcp.mjs','--db',':memory:'],{
    input:'\n{bad json}\n'+requests.map(x=>JSON.stringify(x)).join('\n')+'\n',encoding:'utf8',timeout:10000
  });
  assert.equal(run.status,0,run.stderr);
  const output=run.stdout.trim().split('\n').map(x=>JSON.parse(x));
  assert.equal(output.length,requests.length); // one parse error, no notification response
  assert.equal(output[0].error.code,-32700);
  const results=new Map(output.slice(1).map(x=>[x.id,x]));
  assert.equal(results.get('init').result.protocolVersion,'2024-11-05');
  assert.equal(results.get(2).result.tools.length,8);
  for (const tool of results.get(2).result.tools) assert.equal(tool.inputSchema.type,'object');
  assert.equal(value(results.get(3).result).text,'One');
  assert.equal(results.get(4).result.isError,true);
  assert.equal(value(results.get(5).result).length,1);
  assert.equal(results.get(6).result.resources[0].uri,'notes://all');
  const resource=JSON.parse(results.get(7).result.contents[0].text);
  assert.equal(resource[0].id,1); assert.equal(resource[0].text,'One');
  assert.deepEqual(value(results.get(8).result).tags,['other']);
  assert.equal(value(results.get(9).result).text,'changed');
  assert.deepEqual(value(results.get(10).result),[{name:'other',count:1}]);
  assert.deepEqual(value(results.get(11).result),{version:1,notes:[{text:'changed',tags:['other']}]});
  assert.equal(value(results.get(12).result).length,1);
  assert.equal(value(results.get(13).result),true); assert.equal(value(results.get(14).result),null);
  assert.equal(results.get(15).error.code,-32601); assert.equal(results.get(16).error.code,-32002);
  assert.equal(results.get(17).result.isError,true);
});

test('web dashboard and JSON API with shared persistent MCP database', {timeout:20000},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'quick-web-')), path=join(dir,'notes.sqlite');
  const child=spawn(process.execPath,['src/web.mjs','--db',path,'--port','0'],{stdio:['ignore','pipe','pipe']});
  let stderr=''; child.stderr.on('data',data=>stderr+=data);
  const exited=once(child,'exit');
  t.after(async()=>{if(child.exitCode===null) child.kill();await exited;rmSync(dir,{recursive:true,force:true});});
  const lines=createInterface({input:child.stdout});
  const [line]=await once(lines,'line');
  const {port}=JSON.parse(line); assert.ok(port>0,stderr);
  const request=(route,method='GET',data)=>fetch(`http://127.0.0.1:${port}${route}`,{method,redirect:'manual',...(data===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});
  let response=await request('/api/notes','POST',{text:'<script>alert("x")</script> 100%_',tags:['Work','<tag>']});
  assert.equal(response.status,201);const note=await response.json();
  assert.equal((await (await request('/api/notes?q=%25')).json()).length,1);
  assert.equal((await (await request('/api/notes?tag=WORK')).json())[0].id,note.id);
  assert.equal((await request('/api/notes?limit=0')).status,400);
  response=await request('/');const dashboard=await response.text();
  assert.ok(dashboard.includes('&lt;script&gt;'));assert.ok(!dashboard.includes('<script>'));
  assert.ok(dashboard.includes('&lt;tag&gt;'));assert.ok(dashboard.includes('Create note'));
  assert.ok((await (await request(`/notes/${note.id}/edit`)).text()).includes('Save changes'));
  assert.equal((await request('/api/notes/999')).status,404);
  assert.equal((await request('/api/import','POST',{notes:[{text:'valid'},{text:'bad',tags:[5]}]})).status,400);
  assert.equal((await (await request('/api/notes')).json()).length,1);
  const imported=await (await request('/api/import','POST',{notes:Array.from({length:24},(_,i)=>({text:'bulk '+i,tags:['bulk']}))})).json();
  assert.equal(imported.length,24);
  assert.equal((await (await request('/api/export')).json()).notes[0].text,note.text);
  assert.ok((await (await request('/?page=2')).text()).includes('Previous'));
  assert.equal((await (await request('/api/notes?limit=20&offset=20')).json()).length,5);
  assert.equal((await (await request('/api/tags')).json()).find(tag=>tag.name==='bulk').count,24);
  response=await request(`/api/notes/${note.id}`,'PATCH',{text:'patched',tags:['new']});
  assert.equal((await response.json()).text,'patched');
  assert.equal((await request(`/api/notes/${note.id}`,'PATCH',{text:'no',tags:[null]})).status,400);
  assert.equal((await (await request(`/api/notes/${note.id}`)).json()).text,'patched');
  response=await fetch(`http://127.0.0.1:${port}/notes`,{method:'POST',redirect:'manual',body:new URLSearchParams({text:'form note',tags:' Home,home, Extra '})});
  assert.equal(response.status,303); assert.equal(response.headers.get('location'),'/');
  const formNote=(await (await request('/api/notes')).json())[0];
  response=await fetch(`http://127.0.0.1:${port}/notes/${formNote.id}`,{method:'POST',redirect:'manual',body:new URLSearchParams({text:'edited',tags:'done'})});
  assert.equal(response.status,303);
  response=await fetch(`http://127.0.0.1:${port}/notes/${formNote.id}/delete`,{method:'POST',redirect:'manual'});
  assert.equal(response.status,303);
  response=await request(`/api/notes/${note.id}`,'DELETE');assert.equal(await response.json(),true);
  assert.equal((await request(`/api/notes/${note.id}`,'DELETE')).status,404);
  assert.equal((await request('/missing')).status,404);
  child.kill(); await exited; lines.close();
  const run=spawnSync(process.execPath,['src/mcp.mjs','--db',path],{input:JSON.stringify(rpc(1,'tools/call',{name:'notes_list',arguments:{limit:100}}))+'\n',encoding:'utf8',timeout:5000});
  assert.equal(run.status,0,run.stderr); assert.equal(value(JSON.parse(run.stdout).result).length,24);
});
