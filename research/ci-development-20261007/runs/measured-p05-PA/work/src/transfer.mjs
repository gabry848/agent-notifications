import {StringDecoder} from 'node:string_decoder';
import {parseCSV, stringifyCSV} from './csv.mjs';
import {normalizeRecord} from './catalog.mjs';

const header = ['id', 'name', 'version', 'tags', 'dependencies'];
const addAll = (records, catalog) => catalog.applyBatch(records.map(record => ({type: 'add', record})));
export function exportCSV(records) {
  return stringifyCSV([header, ...records.map(r => [r.id, r.name, r.version, r.tags.join('|'), r.dependencies.join('|')])]);
}
export function importCSV(text, catalog) {
  const rows = parseCSV(text);
  if (!rows.length || rows[0].length !== header.length || rows[0].some((v, i) => v !== header[i])) throw new Error('Invalid CSV header');
  const records = rows.slice(1).map(row => {
    if (row.length !== 5) throw new Error('Invalid CSV record');
    const [id, name, version, tags, dependencies] = row;
    return normalizeRecord({id, name, version, tags: tags ? tags.split('|') : [], dependencies: dependencies ? dependencies.split('|') : []});
  });
  return addAll(records, catalog);
}
export async function* exportNDJSON(records) {
  for (const record of records) yield JSON.stringify(record) + '\n';
}
export async function importNDJSON(chunks, catalog) {
  const decoder = new StringDecoder('utf8');
  const records = [];
  let pending = '';
  function consume(text) {
    pending += text;
    let index;
    while ((index = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, index); pending = pending.slice(index + 1);
      parseLine(line);
    }
  }
  function parseLine(line) {
    if (line.trim()) records.push(normalizeRecord(JSON.parse(line)));
  }
  for await (const chunk of chunks) {
    if (Buffer.isBuffer(chunk)) consume(decoder.write(chunk));
    else if (typeof chunk === 'string') { consume(decoder.end()); consume(chunk); }
    else throw new Error('Invalid NDJSON chunk');
  }
  consume(decoder.end()); parseLine(pending);
  return addAll(records, catalog);
}
