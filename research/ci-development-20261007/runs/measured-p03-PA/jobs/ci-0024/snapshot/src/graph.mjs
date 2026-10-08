export function planDependencies(records,requestedIds) {
  if(!Array.isArray(requestedIds)||requestedIds.some(id=>typeof id!=='string')) throw new Error('invalid requested ids');
  const map=new Map(records.map(r=>[r.id,r])), done=new Set(), active=[], result=[];
  function visit(id) {
    if(done.has(id)) return;
    if(active.includes(id)) throw new Error('cycle: '+[...active.slice(active.indexOf(id)),id].join(' -> '));
    const r=map.get(id);if(!r) throw new Error('missing id: '+id);
    active.push(id);r.dependencies.forEach(visit);active.pop();done.add(id);result.push(id);
  }
  requestedIds.forEach(visit);return result;
}
export function reverseDependencies(records,id) {
  if(!records.some(r=>r.id===id)) throw new Error('unknown id: '+id);
  const reverse=new Map();
  for(const r of records) for(const dep of r.dependencies) {if(!reverse.has(dep)) reverse.set(dep,[]);reverse.get(dep).push(r.id);}
  const seen=new Set([id]);
  function visit(key) {for(const parent of reverse.get(key)||[]) if(!seen.has(parent)) {seen.add(parent);visit(parent);}}
  visit(id);seen.delete(id);return [...seen].sort();
}
