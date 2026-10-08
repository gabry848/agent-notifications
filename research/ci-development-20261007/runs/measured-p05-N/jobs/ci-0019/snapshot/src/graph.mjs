export function planDependencies(records, requestedIds) {
  if (!Array.isArray(requestedIds) || requestedIds.some(id => typeof id !== 'string')) throw Error('Invalid requested ids');
  const nodes = new Map(records.map(r => [r.id,r])), done = new Set(), active = [], result = [];
  function visit(id) {
    if (!nodes.has(id)) throw Error(`Missing id: ${id}`);
    if (done.has(id)) return;
    const cycle = active.indexOf(id);
    if (cycle !== -1) throw Error(`Cycle: ${[...active.slice(cycle),id].join(' -> ')}`);
    active.push(id);
    for (const dependency of nodes.get(id).dependencies) visit(dependency);
    active.pop(); done.add(id); result.push(id);
  }
  for (const id of requestedIds) visit(id);
  return result;
}
export function reverseDependencies(records, id) {
  if (!records.some(r => r.id === id)) throw Error(`Unknown id: ${id}`);
  const reverse = new Map();
  for (const r of records) for (const dep of r.dependencies) {
    if (!reverse.has(dep)) reverse.set(dep, []);
    reverse.get(dep).push(r.id);
  }
  const seen = new Set([id]), pending = [id];
  while (pending.length) for (const dependent of reverse.get(pending.pop()) ?? []) {
    if (!seen.has(dependent)) { seen.add(dependent); pending.push(dependent); }
  }
  seen.delete(id); return [...seen].sort();
}
