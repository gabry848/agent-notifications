export function parseCSV(text) {
  if(typeof text !== 'string') throw Error('CSV must be a string');
  if(!text.length) return [];
  const rows=[]; let row=[], field='', state='start', ended=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i]; ended=false;
    if(state==='quoted') {
      if(c==='"') { if(text[i+1]==='"') {field+='"';i++;} else state='closed'; }
      else field+=c;
      continue;
    }
    if(c===',' || c==='\n' || c==='\r') {
      row.push(field); field='';state='start';
      if(c!==',') { if(c==='\r' && text[i+1]==='\n') i++; rows.push(row);row=[];ended=true; }
    } else if(c==='"' && state==='start') state='quoted';
    else { if(c==='"' || state==='closed') throw Error('invalid CSV quote'); field+=c;state='plain'; }
  }
  if(state==='quoted') throw Error('unclosed CSV quote');
  if(!ended) {row.push(field);rows.push(row);}
  return rows;
}
export function stringifyCSV(rows) {
  return rows.map(row=>row.map(value=>{
    if(typeof value !== 'string') throw Error('CSV values must be strings');
    return /[",\r\n]/.test(value) ? '"'+value.replaceAll('"','""')+'"' : value;
  }).join(',')).join('\r\n');
}
