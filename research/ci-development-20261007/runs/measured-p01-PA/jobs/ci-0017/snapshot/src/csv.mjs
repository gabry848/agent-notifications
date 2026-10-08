export function parseCSV(text) {
  if (typeof text !== 'string') throw Error('CSV must be text');
  if (!text.length) return [];
  const rows=[]; let row=[], field='', state='start', ended=false;
  const finishField=()=>{row.push(field);field='';state='start';};
  const finishRow=()=>{finishField();rows.push(row);row=[];ended=true;};
  for(let i=0;i<text.length;i++) {
    const c=text[i]; ended=false;
    if(state==='quoted') {
      if(c==='"') {
        if(text[i+1]==='"') {field+='"';i++;} else state='closed';
      } else field+=c;
      continue;
    }
    if(c===',') {finishField();continue;}
    if(c==='\r' || c==='\n') {if(c==='\r' && text[i+1]==='\n') i++;finishRow();continue;}
    if(state==='closed') throw Error('invalid text after CSV quote');
    if(c==='"') {if(state!=='start') throw Error('quote in unquoted CSV field');state='quoted';}
    else {field+=c;state='plain';}
  }
  if(state==='quoted') throw Error('unclosed CSV quote');
  if(!ended) finishRow();
  return rows;
}
export function stringifyCSV(rows) {
  return rows.map(row=>row.map(value=>{
    const s=String(value);return /[",\r\n]/.test(s) ? '"'+s.replaceAll('"','""')+'"' : s;
  }).join(',')).join('\r\n');
}
