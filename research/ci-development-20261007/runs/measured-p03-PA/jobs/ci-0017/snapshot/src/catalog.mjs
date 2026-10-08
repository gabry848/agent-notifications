import {parseVersion} from './version.mjs';
const copy = r => ({...r,tags:[...r.tags],dependencies:[...r.dependencies]});
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export function normalizeRecord(r) {
  if(!object(r) || typeof r.id!=='string' || !r.id.trim() || typeof r.name!=='string' || !r.name.trim()) throw new Error('invalid record id/name');
  parseVersion(r.version);
  for(const key of ['tags','dependencies']) if(!Array.isArray(r[key]) || r[key].some(v=>typeof v!=='string')) throw new Error('invalid '+key);
  if(r.dependencies.some(v=>!v.trim())) throw new Error('invalid dependency id');
  return {id:r.id.trim(),name:r.name.trim(),version:r.version,tags:[...new Set(r.tags.map(t=>t.trim().toLowerCase()).filter(Boolean))].sort(),dependencies:[...new Set(r.dependencies)]};
}
export function createCatalog(seed=[]) {
  if(!Array.isArray(seed)) throw new Error('invalid seed');
  let entries=new Map();
  function add(map,r) {const n=normalizeRecord(r);if(map.has(n.id)) throw new Error('duplicate id: '+n.id);map.set(n.id,n);return copy(n);}
  function update(map,id,patch) {
    if(!map.has(id)) throw new Error('unknown id: '+id);
    if(!object(patch) || ('id' in patch && patch.id!==id)) throw new Error('invalid patch/id change');
    const n=normalizeRecord({...map.get(id),...patch});map.set(id,n);return copy(n);
  }
  seed.forEach(r=>add(entries,r));
  return {
    list:()=>[...entries.keys()].sort().map(id=>copy(entries.get(id))),
    get:id=>entries.has(id)?copy(entries.get(id)):null,
    add:r=>add(entries,r), update:(id,p)=>update(entries,id,p),remove:id=>entries.delete(id),
    applyBatch(operations) {
      if(!Array.isArray(operations)) throw new Error('invalid operations');
      const draft=new Map(entries);
      const results=operations.map(op=>{
        if(!object(op)) throw new Error('invalid operation');
        if(op.type==='add') return add(draft,op.record);
        if(typeof op.id!=='string' || !op.id.trim()) throw new Error('invalid operation id');
        if(op.type==='update') return update(draft,op.id,op.patch);
        if(op.type==='remove') return draft.delete(op.id);
        throw new Error('invalid operation');
      });
      entries=draft;return results;
    }
  };
}
