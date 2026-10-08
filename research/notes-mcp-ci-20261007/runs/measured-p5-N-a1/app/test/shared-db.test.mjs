import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';

test('web and MCP sequentially share the same persistent SQLite file',{timeout:15000},async()=>{
  const dir=mkdtempSync(join(process.cwd(),'test/.shared-'));
  const db=join(dir,'notes.sqlite');
  const web=spawn(process.execPath,['src/web.mjs','--db',db,'--port','0']);
  web.stderr.resume();
  try {
    const lines=createInterface({input:web.stdout});
    const [line]=await once(lines,'line');const {port}=JSON.parse(line);
    const response=await fetch(`http://127.0.0.1:${port}/api/notes`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'shared note',tags:['Shared']})});
    const created=await response.json();assert.equal(response.status,201);
    const exit=once(web,'exit');web.kill('SIGTERM');assert.equal((await exit)[0],0);
    const request={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'notes_get',arguments:{id:created.id}}};
    const mcp=spawnSync(process.execPath,['src/mcp.mjs','--db',db],{input:JSON.stringify(request)+'\n',encoding:'utf8',timeout:5000});
    assert.equal(mcp.status,0,mcp.stderr);
    const result=JSON.parse(mcp.stdout);
    assert.deepEqual(JSON.parse(result.result.content[0].text),created);
  } finally {
    if (web.exitCode===null) {const exit=once(web,'exit');web.kill();await exit;}
    rmSync(dir,{recursive:true,force:true});
  }
});
