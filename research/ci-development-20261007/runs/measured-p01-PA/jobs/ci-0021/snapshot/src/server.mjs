import http from 'node:http';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {exportCSV,importCSV,exportNDJSON,importNDJSON} from './transfer.mjs';
const maxBody=1024*1024;
async function body(req) {
  const chunks=[];let size=0;
  for await(const chunk of req) {
    size+=chunk.length;
    if(size>maxBody) {const e=Error('request body exceeds 1 MiB');e.status=413;throw e;}
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function queryFor(params) {
  const query={};
  for(const key of ['text','versionMin','versionMax','sortBy','order']) if(params.has(key)) query[key]=params.get(key);
  if(params.has('tags')) query.tags=params.get('tags').split(',');
  for(const key of ['offset','limit']) if(params.has(key)) {
    const value=params.get(key);
    if(!/^[0-9]+$/.test(value)) throw Error('invalid paging');
    query[key]=Number(value);
  }
  return query;
}
export function createServer(catalog) {
  return http.createServer(async(req,res)=>{
    const send=(status,data,type='application/json')=>{
      res.writeHead(status,{'content-type':type});res.end(type==='application/json'?JSON.stringify(data):data);
    };
    try {
      const url=new URL(req.url,'http://localhost'),path=url.pathname,method=req.method;
      if(method==='GET' && path==='/health') return send(200,{ok:true});
      if(method==='GET' && path==='/records') return send(200,searchRecords(catalog.list(),queryFor(url.searchParams)));
      if(method==='POST' && path==='/records') {
        const record=JSON.parse((await body(req)).toString('utf8'));
        return send(201,catalog.add(record));
      }
      if(path.startsWith('/records/') && ['GET','PATCH','DELETE'].includes(method)) {
        const id=decodeURIComponent(path.slice('/records/'.length));
        if(!catalog.get(id)) return send(404,{error:`unknown id: ${id}`});
        if(method==='GET') return send(200,catalog.get(id));
        if(method==='PATCH') return send(200,catalog.update(id,JSON.parse((await body(req)).toString('utf8'))));
        catalog.remove(id);res.writeHead(204);return res.end();
      }
      if(method==='GET' && path==='/plan') {
        const raw=url.searchParams.get('ids');
        return send(200,{ids:planDependencies(catalog.list(),raw ? raw.split(','):[])});
      }
      if(method==='GET' && path==='/export.csv') return send(200,exportCSV(catalog.list()),'text/csv');
      if(method==='POST' && path==='/import.csv') return send(201,{added:importCSV((await body(req)).toString('utf8'),catalog).length});
      if(method==='POST' && path==='/import.ndjson') {
        const data=await body(req);return send(201,{added:(await importNDJSON([data],catalog)).length});
      }
      if(method==='GET' && path==='/export.ndjson') {
        res.writeHead(200,{'content-type':'application/x-ndjson'});
        for await(const line of exportNDJSON(catalog.list())) res.write(line);
        return res.end();
      }
      return send(404,{error:'unknown route'});
    } catch(error) {
      if(res.headersSent) {res.end();return;}
      send(error.status??(/^duplicate id:/.test(error.message)?409:400),{error:error.message});
    }
  });
}
