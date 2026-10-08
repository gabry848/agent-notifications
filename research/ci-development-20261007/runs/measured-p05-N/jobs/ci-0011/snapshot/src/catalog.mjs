import {parseVersion} from './version.mjs';
const copy = value => structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function normalizeRecord(record) {
  if (!object(record)) throw Error('Invalid record');
  const {id, name, version, tags, dependencies} = record;
  if (typeof id !== 'string' || !id.trim() || typeof name !== 'string' || !name.trim()) throw Error('Invalid id/name');
  parseVersion(version);
  if (!Array.isArray(tags) || tags.some(t => typeof t !== 'string') || !Array.isArray(dependencies) || dependencies.some(d => typeof d !== 'string' || !d.length)) throw Error('Invalid tags/dependencies');
  return {id: id.trim(), name: name.trim(), version, tags: [...new Set(tags.map(t => t.trim().toLowerCase()).filter(Boolean))].sort(), dependencies: [...new Set(dependencies)]};
}
export function createCatalog(seed = []) {
  if (!Array.isArray(seed)) throw Error('Invalid seed');
  let entries = new Map();
  function addTo(map, record) {
    const r = normalizeRecord(record);
    if (map.has(r.id)) throw Error(`Duplicate id: ${r.id}`);
    map.set(r.id, r); return copy(r);
  }
  for (const r of seed) addTo(entries, r);
  function updateIn(map, id, patch) {
    if (!map.has(id)) throw Error(`Unknown id: ${id}`);
    if (!object(patch) || (Object.hasOwn(patch, 'id') && patch.id !== id)) throw Error('Invalid patch/id change');
    const r = normalizeRecord({...map.get(id), ...patch}); map.set(id, r); return copy(r);
  }
  return {
    list: () => [...entries.values()].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(copy),
    get: id => entries.has(id) ? copy(entries.get(id)) : null,
    add: record => addTo(entries, record),
    update: (id, patch) => updateIn(entries, id, patch),
    remove: id => entries.delete(id),
    applyBatch(operations) {
      if (!Array.isArray(operations)) throw Error('Invalid operations');
      const next = new Map(entries);
      const results = operations.map(op => {
        if (!object(op)) throw Error('Invalid operation');
        if (op.type === 'add') return addTo(next, op.record);
        if (op.type === 'update' && typeof op.id === 'string') return updateIn(next, op.id, op.patch);
        if (op.type === 'remove' && typeof op.id === 'string') return next.delete(op.id);
        throw Error('Invalid operation');
      });
      entries = next; return results;
    }
  };
}
