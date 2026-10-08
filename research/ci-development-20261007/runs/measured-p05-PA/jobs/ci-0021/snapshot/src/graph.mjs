export function planDependencies(records, requestedIds) {
  if (!Array.isArray(records) || !Array.isArray(requestedIds) || requestedIds.some(id => typeof id !== 'string')) throw new Error('Invalid dependency request');
  const nodes = new Map(records.map(r => [r.id, r]));
  const done = new Set(), active = new Set(), stack = [], result = [];
  function visit(id) {
    if (!nodes.has(id)) throw new Error(`Missing dependency id: ${id}`);
    if (active.has(id)) throw new Error(`Dependency cycle: ${[...stack.slice(stack.indexOf(id)), id].join(' -> ')}`);
    if (done.has(id)) return;
    active.add(id); stack.push(id);
    for (const dependency of nodes.get(id).dependencies) visit(dependency);
    stack.pop(); active.delete(id); done.add(id); result.push(id);
  }
  requestedIds.forEach(visit);
  return result;
}

export function reverseDependencies(records, id) {
  const nodes = new Map(records.map(r => [r.id, r]));
  if (!nodes.has(id)) throw new Error(`Unknown id: ${id}`);
  const reverse = new Map();
  for (const record of records) for (const dependency of record.dependencies) {
    if (!reverse.has(dependency)) reverse.set(dependency, []);
    reverse.get(dependency).push(record.id);
  }
  const visited = new Set([id]), pending = [id];
  while (pending.length) {
    for (const dependent of reverse.get(pending.pop()) ?? []) {
      if (!visited.has(dependent)) { visited.add(dependent); pending.push(dependent); }
    }
  }
  visited.delete(id);
  return [...visited].sort();
}
