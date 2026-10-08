export function planDependencies(records,requestedIds) {
  if(!Array.isArray(requestedIds) || requestedIds.some(id=>typeof id!=='string')) throw Error('invalid requested ids');
  const nodes=new Map(records.map(r=>[r.id,r])),done=new Set(),active=new Set(),path=[],result=[];
  function visit(id) {
    if(!nodes.has(id)) throw Error('missing id: '+id);
    if(active.has(id)) throw Error('cycle: '+[...path.slice(path.indexOf(id)),id].join(' -> '));
    if(done.has(id)) return;
    active.add(id);path.push(id);
    for(const dependency of nodes.get(id).dependencies) visit(dependency);
    path.pop();active.delete(id);done.add(id);result.push(id);
  }
  requestedIds.forEach(visit);return result;
}
export function reverseDependencies(records,id) {
  if(!records.some(r=>r.id===id)) throw Error('unknown id: '+id);
  const reverse=new Map();
  for(const r of records) for(const d of r.dependencies) {
    if(!reverse.has(d)) reverse.set(d,[]);
    reverse.get(d).push(r.id);
  }
  const seen=new Set([id]),queue=[id];
  for(let i=0;i<queue.length;i++) for(const next of reverse.get(queue[i])??[]) if(!seen.has(next)) {seen.add(next);queue.push(next);}
  seen.delete(id);return [...seen].sort();
}
