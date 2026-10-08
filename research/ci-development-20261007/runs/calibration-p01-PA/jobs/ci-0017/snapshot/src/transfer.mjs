import {StringDecoder} from 'node:string_decoder';
import {parseCSV, stringifyCSV} from './csv.mjs';
import {normalizeRecord} from './catalog.mjs';
const header = ['id', 'name', 'version', 'tags', 'dependencies'];
function commit(records, catalog) {
  const normalized = records.map(normalizeRecord);
  return catalog.applyBatch(normalized.map(record => ({type: 'add', record})));
}
export function exportCSV(records) {
  return stringifyCSV([header, ...records.map(r => [r.id, r.name, r.version, r.tags.join('|'), r.dependencies.join('|')])]);
}
export function importCSV(text, catalog) {
  const rows = parseCSV(text);
  if (!rows.length || rows[0].length !== header.length || rows[0].some((v, i) => v !== header[i])) throw Error('invalid CSV header');
  const records = rows.slice(1).map(row => {
    if (row.length !== 5) throw Error('invalid CSV row');
    const [id, name, version, tags, dependencies] = row;
    return {id, name, version, tags: tags ? tags.split('|') : [], dependencies: dependencies ? dependencies.split('|') : []};
  });
  return commit(records, catalog);
}
export async function* exportNDJSON(records) {
  for (const record of records) yield JSON.stringify(record) + '\n';
}
export async function importNDJSON(chunks, catalog) {
  const decoder = new StringDecoder('utf8'), records = []; let pending = '';
  function consume(text) {
    pending += text;
    let end;
    while ((end = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      if (line.trim()) records.push(JSON.parse(line));
    }
  }
  for await (const chunk of chunks) {
    if (typeof chunk === 'string') { consume(decoder.end()); consume(chunk); }
    else if (Buffer.isBuffer(chunk)) consume(decoder.write(chunk));
    else throw Error('NDJSON chunks must be strings or Buffers');
  }
  consume(decoder.end());
  if (pending.trim()) records.push(JSON.parse(pending));
  return commit(records, catalog);
}
