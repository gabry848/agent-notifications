import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const work=resolve(process.argv[2]),group=process.argv[3]??'all';
const imp=name=>import(pathToFileURL(join(work,'src',name+'.mjs')).href);
const record=(id,extra={})=>({id,name:'Package '+id,version:'1.2.3',tags:['tools'],dependencies:[],...extra});
let assertions=0;const check=(fn,label)=>{try{fn();assertions++;}catch(e){e.message=label+': '+e.message;throw e;}};
async function suite(name){
if(name==='integrity'){for(const file of readdirSync(join(work,'src')).filter(x=>x.endsWith('.mjs'))){const r=spawnSync(process.execPath,['--check',join(work,'src',file)],{encoding:'utf8'});check(()=>assert.equal(r.status,0,r.stderr),'source syntax '+file);}return;}
if(name==='csv'){
 const{parseCSV,stringifyCSV}=await imp('csv');
 check(()=>assert.deepEqual(parseCSV(''),[]),'empty CSV');
 check(()=>assert.deepEqual(parseCSV('"a,b","c""d"\r\n"line\nbreak",tail\r\n'),[['a,b','c"d'],['line\nbreak','tail']]),'quoted CSV commas, escaped quote, newline');
 for(const s of['a"b,c','"unterminated','"a"suffix,b'])check(()=>assert.throws(()=>parseCSV(s)), 'reject malformed CSV '+JSON.stringify(s));
 for(let i=0;i<2500;i++){const rows=[[' id '+i,'comma,'+i,'quote"'+i],['newline\n'+i,'雪😀','']];check(()=>assert.deepEqual(parseCSV(stringifyCSV(rows)),rows),'CSV roundtrip '+i);}return;
}
if(name==='version'){
 const{parseVersion,compareVersions:c}=await imp('version');
 check(()=>assert.deepEqual(parseVersion('2.10.3-alpha.12'),{major:2,minor:10,patch:3,prerelease:['alpha','12']}),'parsed version');
 const ordered=['1.0.0-alpha','1.0.0-alpha.1','1.0.0-alpha.beta','1.0.0-beta','1.0.0-beta.2','1.0.0-beta.11','1.0.0-rc.1','1.0.0','1.0.1','1.2.0','1.10.0','2.0.0'];
 for(let a=0;a<ordered.length;a++)for(let b=0;b<ordered.length;b++)check(()=>assert.equal(c(ordered[a],ordered[b]),Math.sign(a-b)),'semantic order '+ordered[a]+' vs '+ordered[b]);
 for(const s of['1.2','1.2.3.4','01.2.3','1.2.3-01','1.2.3-','1.2.3+meta','1.-2.3','a.b.c'])check(()=>assert.throws(()=>parseVersion(s)),'reject invalid version '+s);
 for(let i=0;i<4000;i++)check(()=>assert.equal(c('2.'+i+'.0','10.0.0'),-1),'numeric major version '+i);return;
}
if(name==='catalog'){
 const{createCatalog}=await imp('catalog');const a=record('a',{tags:[' TOOLS ','tools','',' Web '],dependencies:['b','b','c']});const c=createCatalog([a]);
 check(()=>assert.deepEqual(c.get('a').tags,['tools','web']),'normalize unique tags');check(()=>assert.deepEqual(c.get('a').dependencies,['b','c']),'dedupe dependencies');a.name='mutated';check(()=>assert.equal(c.get('a').name,'Package a'),'seed copied');const got=c.get('a');got.tags.push('bad');check(()=>assert.deepEqual(c.get('a').tags,['tools','web']),'get deep copy');
 check(()=>assert.throws(()=>c.add(record('a'))),'reject duplicate id');check(()=>assert.throws(()=>c.update('missing',{name:'x'})),'reject missing update');check(()=>assert.throws(()=>c.update('a',{id:'other'})),'reject changed id');
 const before=c.list();check(()=>assert.throws(()=>c.applyBatch([{type:'add',record:record('b')},{type:'update',id:'a',patch:{version:'invalid'}}])),'invalid batch rejected');check(()=>assert.deepEqual(c.list(),before),'failed batch must roll back earlier add');
 check(()=>assert.throws(()=>c.applyBatch([{type:'remove',id:'a'},{type:'nonsense'}])),'bad operation');check(()=>assert.deepEqual(c.list(),before),'remove rollback');c.add(record('z'));c.add(record('A'));check(()=>assert.deepEqual(c.list().map(r=>r.id),['A','a','z']),'ASCII list order');check(()=>assert.equal(c.remove('missing'),false),'absent remove');
 for(let i=0;i<500;i++){const r=record('n'+i);c.add(r);r.dependencies.push('bad');check(()=>assert.deepEqual(c.get(r.id).dependencies,[]),'add input clone '+i);}return;
}
if(name==='search'){
 const{searchRecords:s}=await imp('search');const rows=[record('a',{name:'Same',version:'2.0.0',tags:['tools','web']}),record('b',{name:'Same',version:'10.0.0'}),record('c',{name:'Other',version:'1.0.0-rc.1'})];const before=JSON.stringify(rows);
 check(()=>assert.deepEqual(s(rows,{sortBy:'version',order:'desc'}).items.map(r=>r.id),['b','a','c']),'numeric version sorting');check(()=>assert.deepEqual(s(rows,{sortBy:'name',order:'desc'}).items.map(r=>r.id),['a','b','c']),'tie id always ascending');check(()=>assert.equal(s(rows,{text:' SAME ',tags:[' WEB '],versionMin:'2.0.0'}).total,1),'combined filters');check(()=>assert.deepEqual(s(rows,{offset:1,limit:1}).items.map(r=>r.id),['b']),'paging');
 for(const q of[{limit:0},{limit:101},{offset:-1},{offset:0.5},{sortBy:'bad'},{order:'bad'},{versionMin:'broken'}])check(()=>assert.throws(()=>s(rows,q)),'invalid search '+JSON.stringify(q));check(()=>assert.equal(JSON.stringify(rows),before),'search preserves input');return;
}
if(name==='graph'){
 const{planDependencies:p,reverseDependencies:r}=await imp('graph');const rows=[record('a',{dependencies:['b','c']}),record('b',{dependencies:['d']}),record('c',{dependencies:['d']}),record('d'),record('x')];const before=JSON.stringify(rows);
 check(()=>assert.deepEqual(p(rows,['a','x','a']),['d','b','c','a','x']),'dependency first stable DFS');check(()=>assert.deepEqual(r(rows,'d'),['a','b','c']),'transitive reverse dependencies');check(()=>assert.throws(()=>p(rows,['missing']),/missing/),'missing id error');check(()=>assert.throws(()=>p([record('a',{dependencies:['b']}),record('b',{dependencies:['a']})],['a']),/a.*b|b.*a/),'cycle evidence');check(()=>assert.equal(JSON.stringify(rows),before),'graph preserves input');return;
}
if(name==='transfer'){
 const{createCatalog}=await imp('catalog'),{exportCSV,importCSV,exportNDJSON,importNDJSON}=await imp('transfer');const rows=[record('a',{name:'雪😀, "package"\nline',tags:['tools','web']}),record('b',{dependencies:['a']})];const c=createCatalog();check(()=>assert.deepEqual(importCSV(exportCSV(rows),c),rows),'CSV transfer roundtrip');check(()=>assert.throws(()=>importCSV('bad,header',c)),'CSV header validation');const before=c.list();check(()=>assert.throws(()=>importCSV(exportCSV([record('c'),record('a')]),c)),'duplicate CSV import');check(()=>assert.deepEqual(c.list(),before),'CSV atomic failure');
 let data='';for await(const s of exportNDJSON(rows))data+=s;const bytes=Buffer.from(data.trimEnd());async function*chunks(){for(let i=0;i<bytes.length;i+=2)yield bytes.subarray(i,i+2);}const d=createCatalog();const imported=await importNDJSON(chunks(),d);check(()=>assert.deepEqual(imported,rows),'NDJSON UTF8 split and final no newline');let rejected=false;try{await importNDJSON((async function*(){yield JSON.stringify(record('c'))+'\n{broken}\n';})(),d);}catch{rejected=true;}check(()=>assert.ok(rejected),'malformed NDJSON rejects');check(()=>assert.deepEqual(d.list(),rows),'NDJSON malformed rollback');return;
}
if(name==='http'){
 const{createCatalog}=await imp('catalog'),{createServer}=await imp('server');const server=createServer(createCatalog());await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});const base='http://127.0.0.1:'+server.address().port;
 const request=async(path,method='GET',body)=>fetch(base+path,{method,body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body),headers:{'content-type':'application/json'},signal:AbortSignal.timeout(10000)});
 try{
 let r=await request('/health');check(()=>assert.equal(r.status,200),'health status');const health=await r.json();check(()=>assert.deepEqual(health,{ok:true}),'health body');
 r=await request('/records','POST',record('a/b',{name:'Comma, 😀'}));check(()=>assert.equal(r.status,201),'create record');r=await request('/records','POST',record('a/b'));check(()=>assert.equal(r.status,409),'duplicate conflict');r=await request('/records/a%2Fb');const got=await r.json();check(()=>assert.equal(got.name,'Comma, 😀'),'encoded id');
 r=await request('/records/a%2Fb','PATCH',{tags:[' WEB ','web']});const patch=await r.json();check(()=>assert.deepEqual(patch.tags,['web']),'HTTP normalize patch');r=await request('/records?text=comma&tags=web&limit=1');const filtered=await r.json();check(()=>assert.equal(filtered.total,1),'HTTP search');r=await request('/records?limit=0');check(()=>assert.equal(r.status,400),'HTTP invalid query');r=await request('/records','POST','{');check(()=>assert.equal(r.status,400),'invalid JSON survives');r=await request('/records','POST','x'.repeat(1048577));check(()=>assert.equal(r.status,413),'body limit');r=await request('/health');check(()=>assert.equal(r.status,200),'alive after invalid requests');
 r=await request('/plan?ids=a%2Fb');const plan=await r.json();check(()=>assert.deepEqual(plan.ids,['a/b']),'HTTP dependency plan');r=await request('/export.csv');const csv=await r.text();check(()=>assert.ok(csv.startsWith('id,name,version,tags,dependencies')),'HTTP CSV');r=await request('/import.ndjson','POST',JSON.stringify(record('b'))+'\n');check(()=>assert.equal(r.status,201),'NDJSON HTTP import');r=await request('/export.ndjson');const ndjson=await r.text();check(()=>assert.equal(ndjson.trim().split('\n').length,2),'NDJSON HTTP export');r=await request('/records/a%2Fb','DELETE');check(()=>assert.equal(r.status,204),'HTTP delete');r=await request('/records/a%2Fb');check(()=>assert.equal(r.status,404),'deleted missing');r=await request('/unknown');check(()=>assert.equal(r.status,404),'unknown route');
 }finally{await new Promise(ok=>server.close(ok));}return;
}
if(name==='cli'){
 const dir=mkdtempSync(join(tmpdir(),'ci-development-oracle-')),file=join(dir,'records.json');const run=(args)=>spawnSync(process.execPath,[join(work,'src/cli.mjs'),...args,'--file',file],{encoding:'utf8',timeout:15000});try{let r=run(['add','--record',JSON.stringify(record('a'))]);check(()=>assert.equal(r.status,0,r.stderr),'CLI add');r=run(['list','--text','PACKAGE']);check(()=>assert.equal(JSON.parse(r.stdout).total,1),'CLI search');const before=readFileSync(file,'utf8');r=run(['add','--record',JSON.stringify(record('a'))]);check(()=>assert.notEqual(r.status,0),'CLI duplicate error');check(()=>assert.equal(readFileSync(file,'utf8'),before),'CLI leaves file on failure');r=run(['plan','--ids','a']);check(()=>assert.deepEqual(JSON.parse(r.stdout).ids,['a']),'CLI plan');r=run(['export-csv']);check(()=>assert.ok(r.stdout.startsWith('id,name,version,tags,dependencies')),'CLI export');const csv=join(dir,'in.csv');writeFileSync(csv,'id,name,version,tags,dependencies\nb,Second,2.0.0,tools,a');r=run(['import-csv','--input',csv]);check(()=>assert.equal(r.status,0,r.stderr),'CLI import');r=run(['remove','--id','a']);check(()=>assert.equal(r.status,0,r.stderr),'CLI remove');check(()=>assert.deepEqual(JSON.parse(readFileSync(file,'utf8')).map(r=>r.id),['b']),'CLI file state');}finally{rmSync(dir,{recursive:true,force:true});}return;
}
throw Error('Unknown suite '+name);
}
const groups=group==='all'?['integrity','csv','version','catalog','search','graph','transfer','http','cli']:[group];
const started=Date.now();let current;try{for(current of groups)await suite(current);console.log(JSON.stringify({passed:true,groups,assertions,durationMs:Date.now()-started}));}catch(e){console.log(JSON.stringify({passed:false,group:current,assertions,durationMs:Date.now()-started,error:e.message,stack:e.stack}));process.exitCode=1;}
