export function parseCSV(text) {
  if (typeof text !== 'string') throw new Error('CSV must be a string');
  if (!text.length) return [];
  const rows = [];
  let row = [], field = '', state = 'start', ended = false;
  const finishField = () => { row.push(field); field = ''; state = 'start'; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    ended = false;
    if (state === 'quoted') {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else state = 'closed';
      } else field += c;
      continue;
    }
    if (c === ',') { finishField(); continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      finishField(); rows.push(row); row = []; ended = true; continue;
    }
    if (state === 'closed') throw new Error('Unexpected character after quoted field');
    if (c === '"') {
      if (state !== 'start') throw new Error('Quote in unquoted field');
      state = 'quoted';
    } else { field += c; state = 'unquoted'; }
  }
  if (state === 'quoted') throw new Error('Unclosed CSV quote');
  if (!ended) { finishField(); rows.push(row); }
  return rows;
}

export function stringifyCSV(rows) {
  if (!Array.isArray(rows)) throw new Error('CSV rows must be an array');
  return rows.map(row => {
    if (!Array.isArray(row)) throw new Error('CSV row must be an array');
    return row.map(value => {
      const text = String(value);
      return /[",\r\n]/.test(text) || text === '' ? `"${text.replaceAll('"', '""')}"` : text;
    }).join(',');
  }).join('\r\n');
}
