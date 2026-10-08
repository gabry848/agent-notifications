export function parseCSV(text) {
  if (typeof text !== 'string') throw new Error('CSV must be a string');
  if (!text.length) return [];
  const rows = []; let row = [], field = '', state = 'start';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (state === 'quoted') {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else state = 'closed';
      } else field += c;
      continue;
    }
    if (c === ',') { row.push(field); field = ''; state = 'start'; }
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = ''; state = 'start';
      if (i === text.length - 1) return rows;
    } else if (c === '"' && state === 'start') state = 'quoted';
    else {
      if (c === '"' || state === 'closed') throw new Error('Invalid CSV quote');
      field += c; state = 'plain';
    }
  }
  if (state === 'quoted') throw new Error('Unclosed CSV quote');
  row.push(field); rows.push(row); return rows;
}
export function stringifyCSV(rows) {
  if (!Array.isArray(rows)) throw new Error('Invalid CSV rows');
  return rows.map(row => {
    if (!Array.isArray(row)) throw new Error('Invalid CSV row');
    return row.map(value => {
      const s = String(value);
      return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
    }).join(',');
  }).join('\r\n');
}
