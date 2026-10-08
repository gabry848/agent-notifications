import http from 'node:http';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {exportCSV, importCSV, exportNDJSON, importNDJSON} from './transfer.mjs';

const MAX_BODY = 1024 * 1024;
async function readBody(req) {
  const chunks = [];
  let size = 0, oversized = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) oversized = true;
    else if (!oversized) chunks.push(chunk);
  }
  if (oversized) throw Object.assign(new Error('Request body exceeds 1 MiB'), {status: 413});
  return Buffer.concat(chunks);
}
function json(res, status, value) {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
  res.end(JSON.stringify(value));
}
function searchQuery(params) {
  const query = {};
  for (const key of ['text', 'versionMin', 'versionMax', 'sortBy', 'order']) if (params.has(key)) query[key] = params.get(key);
  if (params.has('tags')) query.tags = params.get('tags').split(',');
  for (const key of ['offset', 'limit']) if (params.has(key)) {
    const value = params.get(key);
    if (!/^[0-9]+$/.test(value)) throw new Error(`Invalid ${key}`);
    query[key] = Number(value);
  }
  return query;
}
export function createServer(catalog) {
  return http.createServer((req, res) => {
    handle(req, res).catch(error => {
      if (res.headersSent) { res.end(); return; }
      const status = error.status ?? (/duplicate/i.test(error.message) ? 409 : 400);
      json(res, status, {error: error.message || 'Invalid request'});
    });
  });
  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname, method = req.method;
    if (method === 'GET' && path === '/health') return json(res, 200, {ok: true});
    if (method === 'GET' && path === '/records') return json(res, 200, searchRecords(catalog.list(), searchQuery(url.searchParams)));
    if (method === 'POST' && path === '/records') {
      const record = JSON.parse((await readBody(req)).toString('utf8'));
      return json(res, 201, catalog.add(record));
    }
    const match = /^\/records\/([^/]+)$/.exec(path);
    if (match && ['GET', 'PATCH', 'DELETE'].includes(method)) {
      const id = decodeURIComponent(match[1]);
      if (!catalog.get(id)) return json(res, 404, {error: `Unknown id: ${id}`});
      if (method === 'GET') return json(res, 200, catalog.get(id));
      if (method === 'PATCH') return json(res, 200, catalog.update(id, JSON.parse((await readBody(req)).toString('utf8'))));
      catalog.remove(id); res.writeHead(204); return res.end();
    }
    if (method === 'GET' && path === '/plan') {
      if (!url.searchParams.has('ids')) throw new Error('Missing ids');
      const value = url.searchParams.get('ids');
      return json(res, 200, {ids: planDependencies(catalog.list(), value ? value.split(',') : [])});
    }
    if (method === 'GET' && path === '/export.csv') {
      res.writeHead(200, {'Content-Type': 'text/csv; charset=utf-8'});
      return res.end(exportCSV(catalog.list()));
    }
    if (method === 'POST' && path === '/import.csv') {
      const added = importCSV((await readBody(req)).toString('utf8'), catalog);
      return json(res, 201, {added: added.length});
    }
    if (method === 'POST' && path === '/import.ndjson') {
      const body = await readBody(req);
      const added = await importNDJSON([body], catalog);
      return json(res, 201, {added: added.length});
    }
    if (method === 'GET' && path === '/export.ndjson') {
      res.writeHead(200, {'Content-Type': 'application/x-ndjson; charset=utf-8'});
      for await (const line of exportNDJSON(catalog.list())) res.write(line);
      return res.end();
    }
    return json(res, 404, {error: 'Not found'});
  }
}
