import {parseVersion} from './version.mjs';
const copy = r => ({...r,tags:[...r.tags],dependencies:[...r.dependencies]});
export function normalizeRecord(r) {
  if(!r || typeof r!=='object' || Array.isArray(r)) throw Error('invalid record');
  if(typeof r.id!=='string' || !r.id.trim() || typeof r.name!=='string' || !r.name.trim()) throw Error('invalid id/name');
  parseVersion(r.version);
  for(const key of ['tags','dependencies']) if(!Array.isArray(r[key]) || r[key].some(v=>typeof v!=='string')) throw Error('invalid '+key);
  if(r.dependencies.some(v=>!v.trim())) throw Error('invalid dependency id');
  return {id:r.id.trim(),name:r.name.trim(),version:r.version,
    tags:[...new Set(r.tags.map(t=>t.trim().toLowerCase()).filter(Boolean))].sort(),
    dependencies:[...new Set(r.dependencies)]};
}
export function createCatalog(seed=[]) {
  if(!Array.isArray(seed)) throw Error('invalid seed');
  let entries=new Map();
  const addTo=(map,r)=> {const value=normalizeRecord(r);if(map.has(value.id)) throw Error('duplicate id: '+value.id);map.set(value.id,value);return copy(value);};
  const updateIn=(map,id,patch)=> {
    if(!map.has(id)) throw Error('unknown id: '+id);
    if(!patch || typeof patch!=='object' || Array.isArray(patch)) throw Error('invalid patch');
    if(Object.hasOwn(patch,'id') && patch.id!==id) throw Error('id cannot change');
    const value=normalizeRecord({...map.get(id),...patch});map.set(id,value);return copy(value);
  };
  for(const r of seed) addTo(entries,r);
  return {
    list:()=>[...entries.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map(copy),
    get:id=>entries.has(id)?copy(entries.get(id)):null,
    add:r=>addTo(entries,r), update:(id,patch)=>updateIn(entries,id,patch),remove:id=>entries.delete(id),
    applyBatch(operations) {
      if(!Array.isArray(operations)) throw Error('invalid operations');
      const next=new Map(entries);
      const results=operations.map(op=> {
        if(!op || typeof op!=='object' || Array.isArray(op)) throw Error('invalid operation');
        if(op.type==='add') return addTo(next,op.record);
        if(op.type==='update' && typeof op.id==='string') return updateIn(next,op.id,op.patch);
        if(op.type==='remove' && typeof op.id==='string' && op.id.trim()) return next.delete(op.id);
        throw Error('invalid operation');
      });
      entries=next;return results;
    }
  };
}
