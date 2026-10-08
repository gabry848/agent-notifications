import {parseVersion} from './version.mjs';
export const asciiCompare = (a, b) => a === b ? 0 : a < b ? -1 : 1;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = r => ({...r, tags: [...r.tags], dependencies: [...r.dependencies]});
export function normalizeRecord(record) {
  if (!object(record) || typeof record.id !== 'string' || !record.id.trim() || typeof record.name !== 'string' || !record.name.trim()) throw Error('invalid record id/name');
  parseVersion(record.version);
  for (const key of ['tags', 'dependencies']) {
    if (!Array.isArray(record[key]) || record[key].some(v => typeof v !== 'string')) throw Error(`invalid record ${key}`);
  }
  if (record.dependencies.some(id => !id.trim())) throw Error('invalid dependency id');
  return {id: record.id.trim(), name: record.name.trim(), version: record.version,
    tags: [...new Set(record.tags.map(t => t.trim().toLowerCase()).filter(Boolean))].sort(asciiCompare),
    dependencies: [...new Set(record.dependencies)]};
}
export function createCatalog(seed = []) {
  if (!Array.isArray(seed)) throw Error('invalid catalog seed');
  let entries = new Map();
  const add = (map, record) => {
    const r = normalizeRecord(record);
    if (map.has(r.id)) throw Error(`duplicate id: ${r.id}`);
    map.set(r.id, r); return copy(r);
  };
  for (const r of seed) add(entries, r);
  const update = (map, id, patch) => {
    if (!map.has(id)) throw Error(`unknown id: ${id}`);
    if (!object(patch) || (Object.hasOwn(patch, 'id') && patch.id !== id)) throw Error('invalid patch or id change');
    const r = normalizeRecord({...map.get(id), ...patch});
    map.set(id, r); return copy(r);
  };
  return {
    list: () => [...entries.values()].sort((a, b) => asciiCompare(a.id, b.id)).map(copy),
    get: id => entries.has(id) ? copy(entries.get(id)) : null,
    add: record => add(entries, record),
    update: (id, patch) => update(entries, id, patch),
    remove: id => entries.delete(id),
    applyBatch(operations) {
      if (!Array.isArray(operations)) throw Error('invalid operations');
      const next = new Map(entries);
      const results = operations.map(op => {
        if (!object(op)) throw Error('invalid operation');
        if (op.type === 'add') return add(next, op.record);
        if (op.type === 'update' && typeof op.id === 'string') return update(next, op.id, op.patch);
        if (op.type === 'remove' && typeof op.id === 'string' && op.id.trim()) return next.delete(op.id);
        throw Error('invalid operation');
      });
      entries = next; return results;
    }
  };
}
