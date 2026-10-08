import {parseVersion} from './version.mjs';
const copy = r => ({...r,tags:[...r.tags],dependencies:[...r.dependencies]});
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export function normalizeRecord(r) {
  if(!object(r) || typeof r.id !== 'string' || !r.id.trim() || typeof r.name !== 'string' || !r.name.trim()) throw Error('invalid record id/name');
  parseVersion(r.version);
  if(!Array.isArray(r.tags) || r.tags.some(t=>typeof t !== 'string') || !Array.isArray(r.dependencies) || r.dependencies.some(d=>typeof d !== 'string' || !d.trim())) throw Error('invalid tags/dependencies');
  return {id:r.id.trim(),name:r.name.trim(),version:r.version,tags:[...new Set(r.tags.map(t=>t.trim().toLowerCase()).filter(Boolean))].sort(),dependencies:[...new Set(r.dependencies)]};
}
export function createCatalog(seed=[]) {
  if(!Array.isArray(seed)) throw Error('invalid seed');
  let entries=new Map();
  function add(map,r) { const n=normalizeRecord(r); if(map.has(n.id)) throw Error('duplicate id: '+n.id); map.set(n.id,n);return copy(n); }
  function update(map,id,patch) {
    if(!map.has(id)) throw Error('unknown id: '+id);
    if(!object(patch) || ('id' in patch && patch.id !== id)) throw Error('invalid patch/id change');
    const n=normalizeRecord({...map.get(id),...patch});map.set(id,n);return copy(n);
  }
  for(const r of seed) add(entries,r);
  return {
    list:()=>[...entries.keys()].sort().map(id=>copy(entries.get(id))),
    get:id=>entries.has(id)?copy(entries.get(id)):null,
    add:r=>add(entries,r), update:(id,patch)=>update(entries,id,patch), remove:id=>entries.delete(id),
    applyBatch(operations) {
      if(!Array.isArray(operations)) throw Error('invalid operations');
      const next=new Map(entries);
      const results=operations.map(op=>{
        if(!object(op)) throw Error('invalid operation');
        if(op.type==='add') return add(next,op.record);
        if((op.type==='update' || op.type==='remove') && (typeof op.id !== 'string' || !op.id.trim())) throw Error('invalid operation id');
        if(op.type==='update') return update(next,op.id,op.patch);
        if(op.type==='remove') return next.delete(op.id);
        throw Error('invalid operation');
      });
      entries=next;return results;
    }
  };
}
