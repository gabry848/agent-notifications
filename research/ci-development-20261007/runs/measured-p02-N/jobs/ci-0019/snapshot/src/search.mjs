import {parseVersion,compareVersions} from './version.mjs';
const cmp=(a,b)=>a<b?-1:a>b?1:0;
export function searchRecords(records,query={}) {
  if(!query || typeof query!=='object' || Array.isArray(query)) throw Error('invalid query');
  const {sortBy='id',order='asc',offset=0,limit=20,text='',tags=[],versionMin,versionMax}=query;
  if(!['id','name','version'].includes(sortBy) || !['asc','desc'].includes(order) || !Number.isInteger(offset) || offset<0 || !Number.isInteger(limit) || limit<1 || limit>100) throw Error('invalid sort/order/paging');
  if(typeof text!=='string' || !Array.isArray(tags) || tags.some(t=>typeof t!=='string')) throw Error('invalid text/tags');
  if(versionMin!==undefined) parseVersion(versionMin);
  if(versionMax!==undefined) parseVersion(versionMax);
  const needle=text.trim().toLowerCase(), required=tags.map(t=>t.trim().toLowerCase()).filter(Boolean);
  const items=records.filter(r=> (!needle || r.id.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle)) && required.every(t=>r.tags.map(v=>v.trim().toLowerCase()).includes(t)) && (versionMin===undefined || compareVersions(r.version,versionMin)>=0) && (versionMax===undefined || compareVersions(r.version,versionMax)<=0));
  items.sort((a,b)=> (order==='asc'?1:-1)*(sortBy==='version'?compareVersions(a.version,b.version):cmp(a[sortBy],b[sortBy])) || cmp(a.id,b.id));
  return {items:structuredClone(items.slice(offset,offset+limit)),total:items.length,offset,limit};
}
