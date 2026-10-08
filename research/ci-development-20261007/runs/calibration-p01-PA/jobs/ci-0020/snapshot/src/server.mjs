import http from 'node:http';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {exportCSV, importCSV, exportNDJSON, importNDJSON} from './transfer.mjs';
import {createCatalog} from './catalog.mjs';
import {pathToFileURL} from 'node:url';
const MAX_BODY = 1024 * 1024;
function error(status, message) { return Object.assign(Error(message), {status}); }
async function body(req) {
  if (Number(req.headers['content-length']) > MAX_BODY) throw error(413, 'request body exceeds 1 MiB');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw error(413, 'request body exceeds 1 MiB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function queryParams(url) {
  const q = {};
  for (const key of ['text', 'versionMin', 'versionMax', 'sortBy', 'order']) if (url.searchParams.has(key)) q[key] = url.searchParams.get(key);
  if (url.searchParams.has('tags')) q.tags = url.searchParams.get('tags').split(',');
  for (const key of ['offset', 'limit']) if (url.searchParams.has(key)) {
    const value = url.searchParams.get(key);
    if (!/^\d+$/.test(value)) throw Error('invalid paging');
    q[key] = Number(value);
  }
  return q;
}
export function createServer(catalog) {
  return http.createServer(async (req, res) => {
    const send = (status, value, type = 'application/json') => {
      res.writeHead(status, {'Content-Type': type});
      res.end(status === 204 ? undefined : type === 'application/json' ? JSON.stringify(value) : value);
    };
    try {
      const url = new URL(req.url, 'http://localhost'), path = url.pathname, method = req.method;
      if (method === 'GET' && path === '/health') return send(200, {ok: true});
      if (method === 'GET' && path === '/records') return send(200, searchRecords(catalog.list(), queryParams(url)));
      if (method === 'POST' && path === '/records') {
        const record = JSON.parse((await body(req)).toString('utf8'));
        try { return send(201, catalog.add(record)); }
        catch (err) { if (/duplicate id/.test(err.message)) err.status = 409; throw err; }
      }
      if (path.startsWith('/records/') && ['GET', 'PATCH', 'DELETE'].includes(method)) {
        const encoded = path.slice('/records/'.length);
        if (!encoded || encoded.includes('/')) throw error(404, 'unknown route');
        const id = decodeURIComponent(encoded);
        if (!catalog.get(id)) throw error(404, `unknown id: ${id}`);
        if (method === 'GET') return send(200, catalog.get(id));
        if (method === 'PATCH') return send(200, catalog.update(id, JSON.parse((await body(req)).toString('utf8'))));
        catalog.remove(id); return send(204);
      }
      if (method === 'GET' && path === '/plan') {
        const ids = url.searchParams.get('ids');
        if (ids === null) throw Error('ids required');
        return send(200, {ids: planDependencies(catalog.list(), ids ? ids.split(',') : [])});
      }
      if (method === 'GET' && path === '/export.csv') return send(200, exportCSV(catalog.list()), 'text/csv');
      if (method === 'POST' && path === '/import.csv') return send(201, {added: importCSV((await body(req)).toString('utf8'), catalog).length});
      if (method === 'POST' && path === '/import.ndjson') {
        const bytes = await body(req);
        return send(201, {added: (await importNDJSON([bytes], catalog)).length});
      }
      if (method === 'GET' && path === '/export.ndjson') {
        let output = '';
        for await (const line of exportNDJSON(catalog.list())) output += line;
        return send(200, output, 'application/x-ndjson');
      }
      throw error(404, 'unknown route');
    } catch (err) {
      if (!res.destroyed && !res.headersSent) send(err.status ?? 400, {error: err.message || 'invalid request'});
      else if (!res.destroyed) res.end();
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer(createCatalog()).listen(Number(process.env.PORT ?? 3000), () => console.log('Package Catalog listening'));
}
