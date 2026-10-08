export function parseCSV(text) {
  if(typeof text !== 'string') throw Error('CSV must be text');
  if(text === '') return [];
  const rows=[]; let row=[], field='', state='plain', started=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i]; started=true;
    if(state==='quoted') {
      if(c==='"') { if(text[i+1]==='"') {field+='"';i++;} else state='closed'; }
      else field+=c;
      continue;
    }
    if(c===',') {row.push(field);field='';state='plain';continue;}
    if(c==='\r' || c==='\n') {
      if(c==='\r' && text[i+1]==='\n') i++;
      row.push(field);rows.push(row);row=[];field='';state='plain';started=false;continue;
    }
    if(state==='closed') throw Error('unexpected character after quote');
    if(c==='"') { if(field!=='') throw Error('quote in unquoted field'); state='quoted'; }
    else field+=c;
  }
  if(state==='quoted') throw Error('unclosed quote');
  if(started) {row.push(field);rows.push(row);}
  return rows;
}
export function stringifyCSV(rows) {
  if(!Array.isArray(rows)) throw Error('invalid CSV rows');
  return rows.map(row=> {
    if(!Array.isArray(row)) throw Error('invalid CSV row');
    return row.map(value=> {const s=String(value);return /[",\r\n]/.test(s) ? '"'+s.replaceAll('"','""')+'"' : s;}).join(',');
  }).join('\r\n');
}
