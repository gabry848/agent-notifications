import {parseVersion} from './version.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = record => ({...record, tags: [...record.tags], dependencies: [...record.dependencies]});
export function normalizeRecord(record) {
  if (!object(record) || typeof record.id !== 'string' || !record.id.trim() ||
      typeof record.name !== 'string' || !record.name.trim() ||
      !Array.isArray(record.tags) || !record.tags.every(t => typeof t === 'string') ||
      !Array.isArray(record.dependencies) || !record.dependencies.every(d => typeof d === 'string' && d.trim())) {
    throw new Error('Invalid record');
  }
  parseVersion(record.version);
  return {id: record.id.trim(), name: record.name.trim(), version: record.version,
    tags: [...new Set(record.tags.map(t => t.trim().toLowerCase()).filter(Boolean))].sort(),
    dependencies: [...new Set(record.dependencies)]};
}
export function createCatalog(seed = []) {
  if (!Array.isArray(seed)) throw new Error('Invalid seed');
  let entries = new Map();
  function addTo(map, record) {
    const normalized = normalizeRecord(record);
    if (map.has(normalized.id)) throw new Error(`Duplicate id: ${normalized.id}`);
    map.set(normalized.id, normalized);
    return copy(normalized);
  }
  function updateIn(map, id, patch) {
    if (!map.has(id)) throw new Error(`Unknown id: ${id}`);
    if (!object(patch) || ('id' in patch && patch.id !== id)) throw new Error('Invalid patch or id change');
    const normalized = normalizeRecord({...map.get(id), ...patch});
    map.set(id, normalized);
    return copy(normalized);
  }
  seed.forEach(record => addTo(entries, record));
  return {
    list: () => [...entries.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(copy),
    get: id => entries.has(id) ? copy(entries.get(id)) : null,
    add: record => addTo(entries, record),
    update: (id, patch) => updateIn(entries, id, patch),
    remove: id => entries.delete(id),
    applyBatch(operations) {
      if (!Array.isArray(operations)) throw new Error('Invalid operations');
      const next = new Map(entries);
      const results = operations.map(op => {
        if (!object(op)) throw new Error('Invalid operation');
        if (op.type === 'add') return addTo(next, op.record);
        if (op.type === 'update') return updateIn(next, op.id, op.patch);
        if (op.type === 'remove' && typeof op.id === 'string' && op.id.trim()) return next.delete(op.id);
        throw new Error('Invalid operation');
      });
      entries = next;
      return results;
    }
  };
}
