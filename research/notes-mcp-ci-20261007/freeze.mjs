import {readFileSync,writeFileSync,readdirSync,statSync,existsSync,mkdirSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('.',import.meta.url));
const files=['contract.md','plan.md','bench-extension.ts','runtime.mjs','run.mjs','ci-worker.mjs','clients.mjs','oracle.mjs','freeze.mjs','preflight.mjs','offline-provider.ts','../../src/pi-extension.ts','../../src/store.mjs','../../src/http.mjs','../../src/notification-context.mjs','../../prompts/v2.txt'];
const walk=(prefix)=>{for(const f of readdirSync(join(root,prefix)).sort()){const rel=join(prefix,f);if(statSync(join(root,rel)).isDirectory())walk(rel);else files.push(rel);}};walk('scaffold');walk('reference');
const hashes=Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(join(root,f))).digest('hex')]));
const defaults=JSON.parse(readFileSync(join(homedir(),'.pi/agent/settings.json'),'utf8'));
const runtime={piVersion:spawnSync('pi',['--version'],{encoding:'utf8'}).stdout.trim(),defaultModel:defaults.defaultModel,defaultProvider:defaults.defaultProvider,defaultThinkingLevel:defaults.defaultThinkingLevel,compaction:defaults.compaction,sdkVersion:JSON.parse(readFileSync(join(root,'../../node_modules/@modelcontextprotocol/sdk/package.json'),'utf8')).version};
const manifest={protocolRevision:'v3.1',createdAt:new Date().toISOString(),phase:process.argv[2]??'calibration',hashes,runtime,queueMs:{legacy_smoke:20000,legacy_integrity:60000,storage:30000,mcp:60000,web:45000},calibrationSeed:7100,seeds:[7101,7102,7103,7104,7105],measuredOrder:[['PA','N'],['N','PA'],['PA','N'],['N','PA'],['PA','N']]};
if(existsSync(join(root,'input-manifest.json'))){const archive=join(root,'manifests');mkdirSync(archive,{recursive:true});copyFileSync(join(root,'input-manifest.json'),join(archive,new Date().toISOString().replaceAll(':','-')+'.json'));}
writeFileSync(join(root,'input-manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify({file:'input-manifest.json',phase:manifest.phase,files:files.length,runtime}));
