import { createHash } from 'node:crypto';
import { CONTEXT_TYPE, injectSnapshot } from './store.mjs';

// Entries are Pi session metadata, not transcript messages or new agent turns.
export const JOURNAL_TYPE = 'notification-context-journal-v1';
export const ARCHIVE_TYPE = 'notification-context-archive';
const hash = value => createHash('sha256').update(value).digest('hex');

/** Retain the exact inputs the model previously saw, at their original anchors.
 * Dropping/replacing a delivered user-role snapshot can prevent native Codex
 * from extending its cached conversation, even with unchanged earlier items.
 * A prefix anchor also keeps snapshots out of a different or compacted history.
 */
export function injectCachedSnapshot(messages, snapshot, records, { position = 'tail' } = {}) {
  const clean = messages.filter(m => !(m.role === 'custom' && [CONTEXT_TYPE, ARCHIVE_TYPE].includes(m.customType)));
  const current = injectSnapshot(clean, snapshot, { position });
  const boundary = current.findIndex(m => m.role === 'custom' && m.customType === CONTEXT_TYPE);
  const anchors = [hash('notification-context-prefix-v1')];
  for (const message of clean) anchors.push(hash(anchors.at(-1) + '\n' + JSON.stringify(message)));
  const at = new Map();
  for (const record of records) {
    if (record.version !== 1 || typeof record.anchor !== 'string' || typeof record.content !== 'string' ||
        !Number.isFinite(record.timestamp)) continue;
    const list = at.get(record.anchor) ?? [];
    list.push({ role: 'custom', customType: ARCHIVE_TYPE, content: record.content,
      display: false, timestamp: record.timestamp });
    at.set(record.anchor, list);
  }
  const notification = current[boundary];
  const output = [];
  let archived = 0;
  for (let i = 0; i <= clean.length; i++) {
    const prior = at.get(anchors[i]) ?? [];
    output.push(...prior); archived += prior.length;
    if (i === boundary) output.push(notification);
    if (i < clean.length) output.push(clean[i]);
  }
  return { messages: output, archived, record: { version: 1, anchor: anchors[boundary],
    content: notification.content, timestamp: notification.timestamp, call: snapshot.call } };
}
