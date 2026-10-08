import {parseVersion,compareVersions} from './version.mjs';
export function searchRecords(records,query={}) {
  if(!query || typeof query!=='object' || Array.isArray(query)) throw Error('invalid query');
  const {sortBy='id',order='asc',offset=0,limit=20,text='',tags=[]}=query;
  if(!['id','name','version'].includes(sortBy) || !['asc','desc'].includes(order)) throw Error('invalid sort/order');
  if(!Number.isInteger(offset) || offset<0 || !Number.isInteger(limit) || limit<1 || limit>100) throw Error('invalid paging');
  if(typeof text!=='string' || !Array.isArray(tags) || tags.some(t=>typeof t!=='string')) throw Error('invalid text/tags');
  if(query.versionMin!==undefined) parseVersion(query.versionMin);
  if(query.versionMax!==undefined) parseVersion(query.versionMax);
  const term=text.trim().toLowerCase(), required=[...new Set(tags.map(t=>t.trim().toLowerCase()).filter(Boolean))];
  const cmp=(a,b)=>a<b?-1:a>b?1:0;
  const items=records.filter(r=>(r.name.toLowerCase().includes(term)||r.id.toLowerCase().includes(term)) && required.every(t=>r.tags.map(t=>t.trim().toLowerCase()).includes(t)) && (query.versionMin===undefined||compareVersions(r.version,query.versionMin)>=0) && (query.versionMax===undefined||compareVersions(r.version,query.versionMax)<=0));
  items.sort((a,b)=>((sortBy==='version'?compareVersions(a.version,b.version):cmp(a[sortBy],b[sortBy]))*(order==='asc'?1:-1))||cmp(a.id,b.id));
  return {items:structuredClone(items.slice(offset,offset+limit)),total:items.length,offset,limit};
}
