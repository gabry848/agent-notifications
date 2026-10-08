import {parseVersion} from './version.mjs';
export function createCatalog(seed=[]) {
  const entries=new Map(seed.map(r=>[r.id,r]));
  const api={list:()=>[...entries.values()],get:id=>entries.get(id)??null,
    add:r=>{parseVersion(r.version);entries.set(r.id,r);return r;},
    update:(id,patch)=>{const r={...entries.get(id),...patch};entries.set(id,r);return r;},
    remove:id=>entries.delete(id),applyBatch:operations=>operations.map(op=>{
      if(op.type==='add')return api.add(op.record);if(op.type==='update')return api.update(op.id,op.patch);
      if(op.type==='remove')return api.remove(op.id);throw Error('invalid operation');
    })};return api;
}
