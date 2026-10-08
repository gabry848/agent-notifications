export function planDependencies(records,requestedIds) {
  if(!Array.isArray(requestedIds) || requestedIds.some(id=>typeof id!=='string')) throw Error('invalid requested ids');
  const nodes=new Map(records.map(r=>[r.id,r])), done=new Set(), active=new Set(), path=[], result=[];
  function visit(id) {
    if(!nodes.has(id)) throw Error('missing id: '+id);
    if(active.has(id)) throw Error('cycle: '+[...path.slice(path.indexOf(id)),id].join(' -> '));
    if(done.has(id)) return;
    active.add(id);path.push(id);
    for(const dep of nodes.get(id).dependencies) visit(dep);
    path.pop();active.delete(id);done.add(id);result.push(id);
  }
  for(const id of requestedIds) visit(id);
  return result;
}
export function reverseDependencies(records,id) {
  if(!records.some(r=>r.id===id)) throw Error('unknown id: '+id);
  const reverse=new Map();
  for(const r of records) for(const dep of r.dependencies) {if(!reverse.has(dep)) reverse.set(dep,[]); reverse.get(dep).push(r.id);}
  const seen=new Set([id]), stack=[id];
  while(stack.length) for(const parent of reverse.get(stack.pop())??[]) if(!seen.has(parent)) {seen.add(parent);stack.push(parent);}
  seen.delete(id);return [...seen].sort();
}
