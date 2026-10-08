function index(records) {
  return new Map(records.map(r => [r.id, r]));
}
export function planDependencies(records, requestedIds) {
  if (!Array.isArray(requestedIds) || requestedIds.some(id => typeof id !== 'string')) throw new Error('Invalid requested ids');
  const nodes = index(records), done = new Set(), active = new Set(), path = [], result = [];
  function visit(id) {
    if (!nodes.has(id)) throw new Error(`Missing id: ${id}`);
    if (active.has(id)) throw new Error(`Dependency cycle: ${[...path.slice(path.indexOf(id)), id].join(' -> ')}`);
    if (done.has(id)) return;
    active.add(id); path.push(id);
    for (const dependency of nodes.get(id).dependencies) visit(dependency);
    path.pop(); active.delete(id); done.add(id); result.push(id);
  }
  for (const id of requestedIds) visit(id);
  return result;
}
export function reverseDependencies(records, id) {
  const nodes = index(records);
  if (!nodes.has(id)) throw new Error(`Unknown id: ${id}`);
  const reverse = new Map();
  for (const r of records) for (const dep of r.dependencies) {
    if (!reverse.has(dep)) reverse.set(dep, []);
    reverse.get(dep).push(r.id);
  }
  const found = new Set([id]), queue = [id];
  for (let i = 0; i < queue.length; i++) for (const parent of reverse.get(queue[i]) ?? []) {
    if (!found.has(parent)) { found.add(parent); queue.push(parent); }
  }
  found.delete(id); return [...found].sort();
}
