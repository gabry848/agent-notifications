import { readFileSync, realpathSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
export function installedRuntime() {
  const binary=process.env.PI_BINARY??execFileSync('/usr/bin/which',['pi'],{encoding:'utf8'}).trim();
  const cli=realpathSync(binary),directory=dirname(cli),packagePath=resolve(directory,'../../package.json');
  const chunks=join(directory,'chunks');let loader,chunk;
  for(const name of readdirSync(chunks).filter(n=>/^chunk-.*\.js$/.test(n))){
    const source=readFileSync(join(chunks,name),'utf8');
    const found=source.match(/import\(["'](\.\/openai-codex-responses-[A-Za-z0-9_-]+\.js)["']\)/)?.[1];
    if(found){loader=join(chunks,name);chunk=found;break;}
  }
  if(!chunk||!loader)throw Error('Cannot identify actual installed Codex provider-loader chunk');
  const provider=resolve(dirname(loader),chunk);
  const files=[cli,packagePath,loader,provider];
  return {binary,cli,piVersion:JSON.parse(readFileSync(packagePath,'utf8')).version,providerLoader:loader,providerImplementation:provider,
    fileHashes:Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')])),
    note:'Loader paths and hashes observed from the actual installed CLI bundle; runtime model/API is separately captured from RPC get_state.'};
}
