import {parseVersion} from './version.mjs';
const object = x => x !== null && typeof x==='object' && !Array.isArray(x);
const copy = r => ({...r,tags:[...r.tags],dependencies:[...r.dependencies]});
export function normalizeRecord(r) {
  if(!object(r) || typeof r.id!=='string' || !r.id.trim() || typeof r.name!=='string' || !r.name.trim()) throw Error('invalid record id/name');
  parseVersion(r.version);
  if(!Array.isArray(r.tags) || r.tags.some(t=>typeof t!=='string') || !Array.isArray(r.dependencies) || r.dependencies.some(d=>typeof d!=='string' || !d.trim())) throw Error('invalid tags/dependencies');
  return {id:r.id.trim(),name:r.name.trim(),version:r.version,tags:[...new Set(r.tags.map(t=>t.trim().toLowerCase()).filter(Boolean))].sort(),dependencies:[...new Set(r.dependencies)]};
}
export function createCatalog(seed=[]) {
  if(!Array.isArray(seed)) throw Error('invalid seed');
  let entries=new Map();
  const addTo=(map,r)=>{const value=normalizeRecord(r);if(map.has(value.id)) throw Error(`duplicate id: ${value.id}`);map.set(value.id,value);return copy(value);};
  for(const r of seed) addTo(entries,r);
  const updateIn=(map,id,patch)=>{
    if(!map.has(id)) throw Error(`unknown id: ${id}`);
    if(!object(patch) || ('id' in patch && patch.id!==id)) throw Error('invalid patch/id change');
    const value=normalizeRecord({...map.get(id),...patch});map.set(id,value);return copy(value);
  };
  return {
    list:()=>[...entries.keys()].sort().map(id=>copy(entries.get(id))),
    get:id=>entries.has(id)?copy(entries.get(id)):null,
    add:r=>addTo(entries,r), update:(id,patch)=>updateIn(entries,id,patch), remove:id=>entries.delete(id),
    applyBatch:operations=>{
      if(!Array.isArray(operations)) throw Error('invalid operations');
      const next=new Map(entries);
      const results=operations.map(op=>{
        if(!object(op)) throw Error('invalid operation');
        if(op.type==='add') return addTo(next,op.record);
        if(typeof op.id!=='string' || !op.id.trim()) throw Error('invalid operation id');
        if(op.type==='update') return updateIn(next,op.id,op.patch);
        if(op.type==='remove') return next.delete(op.id);
        throw Error('invalid operation');
      });
      entries=next;return results;
    }
  };
}
