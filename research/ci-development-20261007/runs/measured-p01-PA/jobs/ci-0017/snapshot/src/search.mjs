import {parseVersion,compareVersions} from './version.mjs';
const cmp=(a,b)=>a<b?-1:a>b?1:0;
export function searchRecords(records,query={}) {
  if(!Array.isArray(records) || query===null || typeof query!=='object' || Array.isArray(query)) throw Error('invalid search');
  const {sortBy='id',order='asc',offset=0,limit=20,text='',tags=[]}=query;
  if(!['id','name','version'].includes(sortBy) || !['asc','desc'].includes(order)) throw Error('invalid sort/order');
  if(!Number.isInteger(offset) || offset<0 || !Number.isInteger(limit) || limit<1 || limit>100) throw Error('invalid paging');
  if(typeof text!=='string' || !Array.isArray(tags) || tags.some(t=>typeof t!=='string')) throw Error('invalid search text/tags');
  if(query.versionMin!==undefined) parseVersion(query.versionMin);
  if(query.versionMax!==undefined) parseVersion(query.versionMax);
  const term=text.trim().toLowerCase(), required=[...new Set(tags.map(t=>t.trim().toLowerCase()).filter(Boolean))];
  const found=records.filter(r=>{
    const rt=r.tags.map(t=>t.trim().toLowerCase());
    return (!term || r.id.toLowerCase().includes(term) || r.name.toLowerCase().includes(term)) && required.every(t=>rt.includes(t)) &&
      (query.versionMin===undefined || compareVersions(r.version,query.versionMin)>=0) &&
      (query.versionMax===undefined || compareVersions(r.version,query.versionMax)<=0);
  });
  found.sort((a,b)=>(order==='asc'?1:-1)*(sortBy==='version'?compareVersions(a.version,b.version):cmp(a[sortBy],b[sortBy])) || cmp(a.id,b.id));
  return {items:structuredClone(found.slice(offset,offset+limit)),total:found.length,offset,limit};
}
