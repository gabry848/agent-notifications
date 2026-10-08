import {parseVersion} from './version.mjs';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const copy = v => structuredClone(v);
export function normalizeRecord(record) {
  if(!object(record)) throw Error('invalid record');
  const {id,name,version,tags,dependencies}=record;
  if(typeof id!=='string' || !id.trim() || typeof name!=='string' || !name.trim()) throw Error('invalid id/name');
  parseVersion(version);
  if(!Array.isArray(tags) || tags.some(t=>typeof t!=='string')) throw Error('invalid tags');
  if(!Array.isArray(dependencies) || dependencies.some(d=>typeof d!=='string' || !d.trim())) throw Error('invalid dependencies');
  return {id:id.trim(),name:name.trim(),version,tags:[...new Set(tags.map(t=>t.trim().toLowerCase()).filter(Boolean))].sort(),dependencies:[...new Set(dependencies)]};
}
export function createCatalog(seed=[]) {
  if(!Array.isArray(seed)) throw Error('invalid seed');
  let entries=new Map();
  function apply(map,op) {
    if(!object(op)) throw Error('invalid operation');
    if(op.type==='add') {
      const record=normalizeRecord(op.record);
      if(map.has(record.id)) throw Error('duplicate id: '+record.id);
      map.set(record.id,record);return copy(record);
    }
    if(op.type==='update') {
      if(!map.has(op.id)) throw Error('unknown id: '+op.id);
      if(!object(op.patch) || ('id' in op.patch && op.patch.id!==op.id)) throw Error('invalid patch/id change');
      const record=normalizeRecord({...map.get(op.id),...op.patch});
      map.set(op.id,record);return copy(record);
    }
    if(op.type==='remove') {
      if(typeof op.id!=='string' || !op.id.trim()) throw Error('invalid id');
      return map.delete(op.id);
    }
    throw Error('invalid operation');
  }
  const api={
    list:()=>copy([...entries.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)),
    get:id=>entries.has(id)?copy(entries.get(id)):null,
    add:record=>apply(entries,{type:'add',record}),
    update:(id,patch)=>apply(entries,{type:'update',id,patch}),
    remove:id=>apply(entries,{type:'remove',id}),
    applyBatch:operations=>{
      if(!Array.isArray(operations)) throw Error('invalid operations');
      const next=new Map(entries);
      const results=operations.map(op=>apply(next,op));
      entries=next;return results;
    }
  };
  api.applyBatch(seed.map(record=>({type:'add',record})));
  return api;
}
