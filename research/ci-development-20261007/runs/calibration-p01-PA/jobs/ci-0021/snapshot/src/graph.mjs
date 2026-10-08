import {asciiCompare} from './catalog.mjs';
function index(records) {
  if (!Array.isArray(records)) throw Error('invalid records');
  return new Map(records.map(r => [r.id, r]));
}
export function planDependencies(records, requestedIds) {
  if (!Array.isArray(requestedIds) || requestedIds.some(id => typeof id !== 'string')) throw Error('invalid requested ids');
  const nodes = index(records), done = new Set(), path = [], active = new Set(), result = [];
  function visit(id) {
    if (!nodes.has(id)) throw Error(`missing id: ${id}`);
    if (active.has(id)) throw Error(`dependency cycle: ${[...path.slice(path.indexOf(id)), id].join(' -> ')}`);
    if (done.has(id)) return;
    active.add(id); path.push(id);
    for (const dep of nodes.get(id).dependencies) visit(dep);
    path.pop(); active.delete(id); done.add(id); result.push(id);
  }
  for (const id of requestedIds) visit(id);
  return result;
}
export function reverseDependencies(records, id) {
  const nodes = index(records);
  if (!nodes.has(id)) throw Error(`unknown id: ${id}`);
  const reverse = new Map();
  for (const r of records) for (const dep of r.dependencies) {
    if (!reverse.has(dep)) reverse.set(dep, []);
    reverse.get(dep).push(r.id);
  }
  const seen = new Set([id]), pending = [id];
  while (pending.length) for (const next of reverse.get(pending.pop()) ?? []) {
    if (!seen.has(next)) { seen.add(next); pending.push(next); }
  }
  seen.delete(id); return [...seen].sort(asciiCompare);
}
