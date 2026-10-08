import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {createCatalog} from './catalog.mjs';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {exportCSV,importCSV,exportNDJSON,importNDJSON} from './transfer.mjs';
const MAX=1024*1024;
function body(req) {
  return new Promise((resolve,reject)=>{
    let size=0, oversized=false;const chunks=[];
    req.on('data',chunk=>{
      size+=chunk.length;
      if(size>MAX) {
        if(!oversized) {oversized=true;chunks.length=0;const e=new Error('body exceeds 1 MiB');e.status=413;reject(e);}
      } else if(!oversized) chunks.push(chunk);
    });
    req.on('end',()=>{if(!oversized) resolve(Buffer.concat(chunks).toString('utf8'));});
    req.on('error',reject);
    req.on('aborted',()=>reject(new Error('request aborted')));
  });
}
export function createServer(catalog) {
  return http.createServer(async(req,res)=>{
    const send=(status,value,type='application/json')=>{res.writeHead(status,{'content-type':type});res.end(type==='application/json'?JSON.stringify(value):value);};
    try {
      const url=new URL(req.url,'http://localhost'), path=url.pathname, method=req.method;
      if(method==='GET' && path==='/health') return send(200,{ok:true});
      if(method==='GET' && path==='/records') {
        const query={};
        for(const key of ['text','versionMin','versionMax','sortBy','order']) if(url.searchParams.has(key)) query[key]=url.searchParams.get(key);
        if(url.searchParams.has('tags')) query.tags=url.searchParams.get('tags').split(',');
        for(const key of ['offset','limit']) if(url.searchParams.has(key)) {
          const v=url.searchParams.get(key);if(!/^[0-9]+$/.test(v)) throw new Error('invalid '+key);query[key]=Number(v);
        }
        return send(200,searchRecords(catalog.list(),query));
      }
      if(method==='POST' && path==='/records') {
        const record=JSON.parse(await body(req));
        if(typeof record?.id==='string' && catalog.get(record.id.trim())) return send(409,{error:'duplicate id: '+record.id.trim()});
        return send(201,catalog.add(record));
      }
      if(path.startsWith('/records/') && ['GET','PATCH','DELETE'].includes(method)) {
        const id=decodeURIComponent(path.slice('/records/'.length));
        if(!catalog.get(id)) return send(404,{error:'unknown id: '+id});
        if(method==='GET') return send(200,catalog.get(id));
        if(method==='PATCH') return send(200,catalog.update(id,JSON.parse(await body(req))));
        catalog.remove(id);res.writeHead(204);return res.end();
      }
      if(method==='GET' && path==='/plan') return send(200,{ids:planDependencies(catalog.list(),(url.searchParams.get('ids')||'').split(',').filter(Boolean))});
      if(method==='GET' && path==='/export.csv') return send(200,exportCSV(catalog.list()),'text/csv');
      if(method==='POST' && path==='/import.csv') return send(201,{added:importCSV(await body(req),catalog).length});
      if(method==='POST' && path==='/import.ndjson') {
        const text=await body(req);return send(201,{added:(await importNDJSON([text],catalog)).length});
      }
      if(method==='GET' && path==='/export.ndjson') {
        let text='';for await(const line of exportNDJSON(catalog.list())) text+=line;
        return send(200,text,'application/x-ndjson');
      }
      send(404,{error:'unknown route'});
    } catch(error) {
      if(!res.headersSent) send(error.status||400,{error:error.message||'invalid request'});
      else res.end();
    }
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const port=Number(process.env.PORT||3000);
  createServer(createCatalog()).listen(port,()=>console.log('Package Catalog listening on '+port));
}
