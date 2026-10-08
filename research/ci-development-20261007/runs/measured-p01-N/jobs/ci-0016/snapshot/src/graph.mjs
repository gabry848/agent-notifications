export function planDependencies(records,requestedIds) {
  if(!Array.isArray(requestedIds) || requestedIds.some(id=>typeof id!=='string')) throw Error('invalid requested ids');
  const map=new Map(records.map(r=>[r.id,r])), done=new Set(), active=[], result=[];
  function visit(id) {
    if(done.has(id)) return;
    if(active.includes(id)) throw Error(`dependency cycle: ${[...active.slice(active.indexOf(id)),id].join(' -> ')}`);
    const r=map.get(id);if(!r) throw Error(`missing id: ${id}`);
    active.push(id);for(const dep of r.dependencies) visit(dep);active.pop();done.add(id);result.push(id);
  }
  for(const id of requestedIds) visit(id);
  return result;
}
export function reverseDependencies(records,id) {
  if(!records.some(r=>r.id===id)) throw Error(`unknown id: ${id}`);
  const reverse=new Map();
  for(const r of records) for(const dep of r.dependencies) {if(!reverse.has(dep)) reverse.set(dep,[]);reverse.get(dep).push(r.id);}
  const seen=new Set([id]), pending=[id];
  while(pending.length) for(const next of reverse.get(pending.pop())??[]) if(!seen.has(next)) {seen.add(next);pending.push(next);}
  seen.delete(id);return [...seen].sort();
}
