import http from 'node:http';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createCatalog} from './catalog.mjs';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {exportCSV,importCSV,exportNDJSON,importNDJSON} from './transfer.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});
async function body(req) {
  const chunks=[];let size=0, oversized=false;
  for await(const chunk of req) {size+=chunk.length;if(size>1024*1024) oversized=true;else chunks.push(chunk);}
  if(oversized) throw fail(413,'request body exceeds 1 MiB');
  return Buffer.concat(chunks);
}
const json=(res,status,value)=> {res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
export function createServer(catalog) {
  return http.createServer((req,res)=> {
    const handle=async()=> {
      const url=new URL(req.url,'http://localhost'), path=url.pathname, method=req.method;
      // Read every body before routing, enforcing the limit for all endpoints.
      const data=await body(req);
      if(method==='GET' && path==='/health') return json(res,200,{ok:true});
      if(path==='/records' && method==='GET') {
        const query=Object.fromEntries(url.searchParams);
        if('tags' in query) query.tags=query.tags.split(',');
        for(const key of ['offset','limit']) if(key in query) {
          if(!/^\d+$/.test(query[key])) throw Error('invalid paging');
          query[key]=Number(query[key]);
        }
        return json(res,200,searchRecords(catalog.list(),query));
      }
      if(path==='/records' && method==='POST') {
        try {return json(res,201,catalog.add(JSON.parse(data.toString('utf8'))));}
        catch(error) {if(error.message.startsWith('duplicate id:')) error.status=409;throw error;}
      }
      const match=path.match(/^\/records\/([^/]+)$/);
      if(match && ['GET','PATCH','DELETE'].includes(method)) {
        const id=decodeURIComponent(match[1]);
        if(!catalog.get(id)) throw fail(404,`unknown id: ${id}`);
        if(method==='GET') return json(res,200,catalog.get(id));
        if(method==='PATCH') return json(res,200,catalog.update(id,JSON.parse(data.toString('utf8'))));
        catalog.remove(id);res.writeHead(204);return res.end();
      }
      if(path==='/plan' && method==='GET') return json(res,200,{ids:planDependencies(catalog.list(),(url.searchParams.get('ids')??'').split(',').filter(Boolean))});
      if(path==='/export.csv' && method==='GET') {res.writeHead(200,{'content-type':'text/csv'});return res.end(exportCSV(catalog.list()));}
      if(path==='/import.csv' && method==='POST') return json(res,201,{added:importCSV(data.toString('utf8'),catalog).length});
      if(path==='/import.ndjson' && method==='POST') return json(res,201,{added:(await importNDJSON([data],catalog)).length});
      if(path==='/export.ndjson' && method==='GET') {
        res.writeHead(200,{'content-type':'application/x-ndjson'});
        for await(const line of exportNDJSON(catalog.list())) {if(!res.write(line)) await once(res,'drain');}
        return res.end();
      }
      throw fail(404,'unknown route');
    };
    handle().catch(error=> {if(!res.headersSent) json(res,error.status??400,{error:error.message});else res.destroy();});
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const server=createServer(createCatalog());
  server.listen(Number(process.env.PORT??3000),()=>console.log(`Package Catalog listening on ${server.address().port}`));
}
