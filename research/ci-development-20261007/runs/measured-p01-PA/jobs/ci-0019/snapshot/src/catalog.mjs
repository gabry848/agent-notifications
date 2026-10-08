import {parseVersion} from './version.mjs';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = r => ({...r,tags:[...r.tags],dependencies:[...r.dependencies]});
const identifier = id => {if(typeof id !== 'string' || !id.trim()) throw Error('invalid id');return id.trim();};
function normalize(record) {
  if(!object(record)) throw Error('invalid record');
  const id=identifier(record.id);
  if(typeof record.name !== 'string' || !record.name.trim()) throw Error('invalid name');
  parseVersion(record.version);
  if(!Array.isArray(record.tags) || record.tags.some(t=>typeof t !== 'string')) throw Error('invalid tags');
  if(!Array.isArray(record.dependencies) || record.dependencies.some(d=>typeof d !== 'string' || !d.trim())) throw Error('invalid dependencies');
  return {id,name:record.name.trim(),version:record.version,
    tags:[...new Set(record.tags.map(t=>t.trim().toLowerCase()).filter(Boolean))].sort(),
    dependencies:[...new Set(record.dependencies)]};
}
export function createCatalog(seed=[]) {
  if(!Array.isArray(seed)) throw Error('invalid seed');
  let entries=new Map();
  function apply(map,op) {
    if(!object(op)) throw Error('invalid operation');
    if(op.type==='add') {
      const r=normalize(op.record);if(map.has(r.id)) throw Error(`duplicate id: ${r.id}`);
      map.set(r.id,r);return copy(r);
    }
    if(op.type==='update') {
      const id=identifier(op.id);if(!map.has(id)) throw Error(`unknown id: ${id}`);
      if(!object(op.patch)) throw Error('invalid patch');
      if(Object.hasOwn(op.patch,'id') && op.patch.id !== id) throw Error('cannot change id');
      const r=normalize({...map.get(id),...op.patch});map.set(id,r);return copy(r);
    }
    if(op.type==='remove') return map.delete(identifier(op.id));
    throw Error('invalid operation');
  }
  for(const r of seed) apply(entries,{type:'add',record:r});
  return {
    list:()=>[...entries.keys()].sort().map(id=>copy(entries.get(id))),
    get:id=>entries.has(id) ? copy(entries.get(id)) : null,
    add:record=>apply(entries,{type:'add',record}),
    update:(id,patch)=>apply(entries,{type:'update',id,patch}),
    remove:id=>apply(entries,{type:'remove',id}),
    applyBatch:operations=>{
      if(!Array.isArray(operations)) throw Error('invalid operations');
      const next=new Map(entries);const results=operations.map(op=>apply(next,op));entries=next;return results;
    }
  };
}
