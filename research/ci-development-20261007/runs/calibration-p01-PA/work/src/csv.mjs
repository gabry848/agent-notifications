export function parseCSV(text) {
  if (typeof text !== 'string') throw Error('CSV must be a string');
  if (!text.length) return [];
  const rows = []; let row = [], field = '', state = 'start', ended = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]; ended = false;
    if (state === 'quoted') {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else state = 'closed'; }
      else field += c;
      continue;
    }
    if (c === ',') { row.push(field); field = ''; state = 'start'; continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = ''; state = 'start'; ended = true; continue;
    }
    if (state === 'closed') throw Error('unexpected character after CSV quote');
    if (c === '"') { if (state !== 'start') throw Error('quote in unquoted CSV field'); state = 'quoted'; }
    else { field += c; state = 'plain'; }
  }
  if (state === 'quoted') throw Error('unclosed CSV quote');
  if (!ended) { row.push(field); rows.push(row); }
  return rows;
}
export function stringifyCSV(rows) {
  if (!Array.isArray(rows)) throw Error('CSV rows must be an array');
  return rows.map(row => {
    if (!Array.isArray(row)) throw Error('CSV row must be an array');
    return row.map(value => {
      if (typeof value !== 'string') throw Error('CSV values must be strings');
      return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
    }).join(',');
  }).join('\r\n');
}
