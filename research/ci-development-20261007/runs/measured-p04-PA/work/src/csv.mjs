export function parseCSV(text) {
  if (typeof text !== 'string') throw Error('CSV must be text');
  if (!text.length) return [];
  const rows = []; let row = [], field = '', quoted = false, closed = false, ended = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]; ended = false;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += c;
    } else if (c === ',') {
      row.push(field); field = ''; closed = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = ''; closed = false; ended = true;
    } else if (c === '"') {
      if (field.length || closed) throw Error('quote in unquoted CSV field');
      quoted = true;
    } else {
      if (closed) throw Error('characters after CSV quote');
      field += c;
    }
  }
  if (quoted) throw Error('unclosed CSV quote');
  if (!ended) { row.push(field); rows.push(row); }
  return rows;
}
export function stringifyCSV(rows) {
  return rows.map(row => row.map(value => {
    const s = String(value);
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  }).join(',')).join('\r\n');
}
