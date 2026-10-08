export function parseCSV(text) { return text.trim().split(/\r?\n/).filter(Boolean).map(line=>line.split(',')); }
export function stringifyCSV(rows) { return rows.map(row=>row.join(',')).join('\r\n'); }
