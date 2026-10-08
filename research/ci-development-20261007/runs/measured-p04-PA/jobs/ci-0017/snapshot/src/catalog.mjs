import {parseVersion} from './version.mjs';
const copy = r => ({...r, tags: [...r.tags], dependencies: [...r.dependencies]});
export function normalizeRecord(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.id !== 'string' || !r.id.trim() || typeof r.name !== 'string' || !r.name.trim()) throw Error('invalid record id/name');
  parseVersion(r.version);
  if (!Array.isArray(r.tags) || r.tags.some(t => typeof t !== 'string') || !Array.isArray(r.dependencies) || r.dependencies.some(d => typeof d !== 'string' || !d.trim())) throw Error('invalid record tags/dependencies');
  return {id:r.id.trim(), name:r.name.trim(), version:r.version,
    tags:[...new Set(r.tags.map(t => t.trim().toLowerCase()).filter(Boolean))].sort(), dependencies:[...new Set(r.dependencies)]};
}
export function createCatalog(seed = []) {
  if (!Array.isArray(seed)) throw Error('invalid seed');
  let entries = new Map();
  function addTo(map, record) {
    const r = normalizeRecord(record);
    if (map.has(r.id)) throw Error(`duplicate id: ${r.id}`);
    map.set(r.id,r); return copy(r);
  }
  for (const r of seed) addTo(entries,r);
  function updateIn(map,id,patch) {
    if (!map.has(id)) throw Error(`unknown id: ${id}`);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Error('invalid patch');
    if (Object.hasOwn(patch,'id') && patch.id !== id) throw Error('cannot change id');
    const r = normalizeRecord({...map.get(id),...patch}); map.set(id,r); return copy(r);
  }
  return {
    list: () => [...entries.keys()].sort().map(id => copy(entries.get(id))),
    get: id => entries.has(id) ? copy(entries.get(id)) : null,
    add: r => addTo(entries,r), update: (id,patch) => updateIn(entries,id,patch), remove: id => entries.delete(id),
    applyBatch(operations) {
      if (!Array.isArray(operations)) throw Error('invalid operations');
      const next = new Map(entries);
      const results = operations.map(op => {
        if (!op || typeof op !== 'object' || Array.isArray(op)) throw Error('invalid operation');
        if (op.type === 'add') return addTo(next,op.record);
        if (typeof op.id !== 'string' || !op.id.trim()) throw Error('invalid operation id');
        if (op.type === 'update') return updateIn(next,op.id,op.patch);
        if (op.type === 'remove') return next.delete(op.id);
        throw Error('invalid operation');
      });
      entries = next; return results;
    }
  };
}
