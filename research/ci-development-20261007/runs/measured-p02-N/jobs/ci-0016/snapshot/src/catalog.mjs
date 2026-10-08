import {parseVersion} from './version.mjs';
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export function normalizeRecord(r) {
  if(!object(r) || typeof r.id!=='string' || !r.id.trim() || typeof r.name!=='string' || !r.name.trim()) throw Error('invalid record id/name');
  parseVersion(r.version);
  if(!Array.isArray(r.tags) || r.tags.some(t=>typeof t!=='string') || !Array.isArray(r.dependencies) || r.dependencies.some(d=>typeof d!=='string' || !d.trim())) throw Error('invalid tags/dependencies');
  return {id:r.id.trim(),name:r.name.trim(),version:r.version,tags:[...new Set(r.tags.map(t=>t.trim().toLowerCase()).filter(Boolean))].sort(),dependencies:[...new Set(r.dependencies)]};
}
const copy = r => structuredClone(r);
export function createCatalog(seed=[]) {
  if(!Array.isArray(seed)) throw Error('invalid seed');
  let entries=new Map();
  const apply=(map,op)=> {
    if(!object(op)) throw Error('invalid operation');
    if(op.type==='add') {
      const r=normalizeRecord(op.record);
      if(map.has(r.id)) throw Error(`duplicate id: ${r.id}`);
      map.set(r.id,r);return copy(r);
    }
    if(op.type==='update') {
      if(typeof op.id!=='string' || !map.has(op.id)) throw Error(`unknown id: ${op.id}`);
      if(!object(op.patch) || ('id' in op.patch && op.patch.id!==op.id)) throw Error('invalid patch/id change');
      const r=normalizeRecord({...map.get(op.id),...op.patch});map.set(op.id,r);return copy(r);
    }
    if(op.type==='remove') {
      if(typeof op.id!=='string' || !op.id.trim()) throw Error('invalid id');
      return map.delete(op.id);
    }
    throw Error('invalid operation');
  };
  for(const record of seed) apply(entries,{type:'add',record});
  const api={
    list:()=>[...entries.keys()].sort().map(id=>copy(entries.get(id))),
    get:id=>entries.has(id)?copy(entries.get(id)):null,
    add:record=>apply(entries,{type:'add',record}),
    update:(id,patch)=>apply(entries,{type:'update',id,patch}),
    remove:id=>apply(entries,{type:'remove',id}),
    applyBatch:operations=> {
      if(!Array.isArray(operations)) throw Error('invalid operations');
      const next=new Map(entries);const result=operations.map(op=>apply(next,op));entries=next;return result;
    }
  };return api;
}
