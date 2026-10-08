export function parseCSV(text) {
  if (typeof text !== 'string') throw Error('CSV must be text');
  if (!text.length) return [];
  const rows = []; let row = [], field = '', state = 'plain', started = false;
  const fieldEnd = () => { row.push(field); field = ''; state = 'plain'; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]; started = true;
    if (state === 'quoted') {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else state = 'closed';
      } else field += c;
      continue;
    }
    if (c === ',') { fieldEnd(); continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      fieldEnd(); rows.push(row); row = []; started = false; continue;
    }
    if (state === 'closed') throw Error('Unexpected character after quote');
    if (c === '"') {
      if (field.length) throw Error('Quote in unquoted field');
      state = 'quoted';
    } else field += c;
  }
  if (state === 'quoted') throw Error('Unclosed quote');
  if (started) { fieldEnd(); rows.push(row); }
  return rows;
}

export function stringifyCSV(rows) {
  return rows.map(row => row.map(value => {
    if (typeof value !== 'string') throw Error('CSV values must be strings');
    return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  }).join(',')).join('\r\n');
}
