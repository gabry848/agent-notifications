import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import { join,dirname } from 'node:path';
import { hash,save } from './common.mjs';

const files=['src/pi-extension.ts','src/store.mjs','src/http.mjs','benchmark/extension.ts',
  'benchmark/run.mjs','benchmark/pi-client.mjs','benchmark/jobs-server.mjs','benchmark/worker.mjs',
  'benchmark/scenarios.mjs','benchmark/cache.mjs','benchmark/meter.mjs','benchmark/common.mjs',
  'benchmark/metrics.mjs','benchmark/conclusions.mjs','benchmark/sources.mjs',
  'prompts/v2.txt','prompts/v3.txt','package.json','package-lock.json'];
export function runtimeSources(root){
  const sources=Object.fromEntries(files.map(file=>[file,readFileSync(join(root,file),'utf8')]));
  return {hash:hash(sources),hashes:Object.fromEntries(Object.entries(sources).map(([file,text])=>[file,hash(text)])),sources};
}
export function freezeSources(root,directory){
  const bundle=runtimeSources(root),destination=join(directory,'frozen-runtime');
  for(const [file,text]of Object.entries(bundle.sources)){
    const path=join(destination,file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);
  }
  const metadata={hash:bundle.hash,hashes:bundle.hashes};save(join(destination,'hashes.json'),metadata);
  return metadata;
}
