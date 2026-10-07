import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createHash } from 'node:crypto';
const key = (message: any) => createHash('sha256').update(JSON.stringify(message)).digest('hex');
export default function journalPrototype(pi: ExtensionAPI) {
  let journal: {anchor:string,message:any}[] = [];
  pi.on('session_start', () => { journal=[]; });
  pi.on('context', event => {
    const current = event.messages.find((m:any) => m.role==='custom' && m.customType==='dynamic-notification-memory');
    if (!current) return;
    const clean = event.messages.filter((m:any) => !(m.role==='custom' && m.customType==='dynamic-notification-memory'));
    const output = clean.flatMap((message:any) => [message,...journal.filter(item=>item.anchor===key(message)).map(item=>item.message)]);
    if (clean.length) journal.push({anchor:key(clean.at(-1)),message:structuredClone(current)});
    return {messages:[...output,current]};
  });
}
