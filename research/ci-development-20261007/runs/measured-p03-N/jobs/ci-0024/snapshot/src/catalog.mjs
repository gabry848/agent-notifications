import {parseVersion} from './version.mjs';
const copy = value => structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function normalizeRecord(record) {
  if (!object(record) || typeof record.id !== 'string' || !record.id.trim() || typeof record.name !== 'string' || !record.name.trim()) throw new Error('Invalid record id/name');
  parseVersion(record.version);
  for (const key of ['tags', 'dependencies']) {
    if (!Array.isArray(record[key]) || record[key].some(v => typeof v !== 'string')) throw new Error(`Invalid ${key}`);
  }
  if (record.dependencies.some(v => !v.trim())) throw new Error('Invalid dependency id');
  return {id: record.id.trim(), name: record.name.trim(), version: record.version,
    tags: [...new Set(record.tags.map(t => t.trim().toLowerCase()).filter(Boolean))].sort(),
    dependencies: [...new Set(record.dependencies)]};
}
export function createCatalog(seed = []) {
  if (!Array.isArray(seed)) throw new Error('Invalid seed');
  let entries = new Map();
  function add(map, record) {
    const r = normalizeRecord(record);
    if (map.has(r.id)) throw new Error(`Duplicate id: ${r.id}`);
    map.set(r.id, r); return copy(r);
  }
  function update(map, id, patch) {
    if (!map.has(id)) throw new Error(`Unknown id: ${id}`);
    if (!object(patch) || ('id' in patch && patch.id !== id)) throw new Error('Invalid patch/id change');
    const r = normalizeRecord({...map.get(id), ...patch});
    map.set(id, r); return copy(r);
  }
  for (const r of seed) add(entries, r);
  return {
    list: () => [...entries.keys()].sort().map(id => copy(entries.get(id))),
    get: id => entries.has(id) ? copy(entries.get(id)) : null,
    add: record => add(entries, record),
    update: (id, patch) => update(entries, id, patch),
    remove: id => entries.delete(id),
    applyBatch(operations) {
      if (!Array.isArray(operations)) throw new Error('Invalid operations');
      const next = new Map(entries);
      const results = operations.map(op => {
        if (!object(op)) throw new Error('Invalid operation');
        if (op.type === 'add') return add(next, op.record);
        if (op.type === 'update' && typeof op.id === 'string') return update(next, op.id, op.patch);
        if (op.type === 'remove' && typeof op.id === 'string' && op.id.trim()) return next.delete(op.id);
        throw new Error('Invalid operation');
      });
      entries = next; return results;
    }
  };
}
