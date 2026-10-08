import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { openStore } from './store.mjs';
import { tools, callTool, allNotes } from './service.mjs';

const { values } = parseArgs({ options: { db: { type: 'string', default: 'data/notes.sqlite' } } });
const store = openStore(values.db);
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const resource = { uri: 'notes://all', name: 'All notes', mimeType: 'application/json' };
function dispatch(method, params = {}) {
  switch (method) {
    case 'initialize': return { protocolVersion: '2024-11-05', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'quick-notes', version: '1.0.0' } };
    case 'notifications/initialized': return {};
    case 'ping': return {};
    case 'tools/list': return { tools };
    case 'tools/call':
      try { return { content: [{ type: 'text', text: JSON.stringify(callTool(store, params.name, params.arguments)) }] }; }
      catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
    case 'resources/list': return { resources: [resource] };
    case 'resources/read':
      if (params.uri !== resource.uri) throw { code: -32002, message: 'Unknown resource' };
      return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: JSON.stringify(allNotes(store)) }] };
    default: throw { code: -32601, message: 'Method not found' };
  }
}
function send(message) { process.stdout.write(JSON.stringify(message) + '\n'); }
input.on('line', line => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); }
  catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
  if (!request || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    send({ jsonrpc: '2.0', id: request?.id ?? null, error: { code: -32600, message: 'Invalid request' } }); return;
  }
  const hasId = Object.hasOwn(request, 'id');
  try {
    if (request.params !== undefined && (!request.params || typeof request.params !== 'object' || Array.isArray(request.params))) throw { code: -32602, message: 'Invalid params' };
    const result = dispatch(request.method, request.params);
    if (hasId) send({ jsonrpc: '2.0', id: request.id, result });
  } catch (error) {
    if (hasId) send({ jsonrpc: '2.0', id: request.id, error: { code: error.code ?? -32602, message: error.message ?? 'Invalid params' } });
  }
});
input.on('close', () => store.close());
process.on('SIGINT', () => input.close());
process.on('SIGTERM', () => input.close());
