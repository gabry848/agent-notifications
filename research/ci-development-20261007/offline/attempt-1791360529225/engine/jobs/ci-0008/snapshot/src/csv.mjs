export function parseCSV(text){
 if(typeof text!=='string')throw Error('CSV string required');if(text==='')return[];
 const rows=[];let row=[],field='',quoted=false,closed=false,started=false;
 for(let i=0;i<text.length;i++){const c=text[i];started=true;
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
  if(c==='"'){if(field||closed)throw Error('quote in unquoted field');quoted=true;continue;}
  if(c===','){row.push(field);field='';closed=false;continue;}
  if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field='';closed=false;started=false;continue;}
  if(closed)throw Error('text after quote');field+=c;
 }
 if(quoted)throw Error('unclosed quote');if(started||row.length||field)rows.push([...row,field]);return rows;
}
export function stringifyCSV(rows){return rows.map(r=>r.map(s=>/[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s).join(',')).join('\r\n');}
