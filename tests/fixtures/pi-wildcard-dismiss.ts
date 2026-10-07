import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import notifications from '../../src/pi-extension.ts';
import { NotificationStore } from '../../src/store.mjs';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

// Invoke the actual registered tool offline, without requesting model inference.
export default function wildcardFixture(pi: ExtensionAPI) {
  let dismissTool: any;
  notifications(new Proxy(pi, {
    get(target, property) {
      if (property === 'registerTool') return (tool: any) => {
        if (tool.name === 'notifications_dismiss') dismissTool = tool;
        target.registerTool(tool);
      };
      return Reflect.get(target, property);
    },
  }));
  pi.on('session_start', async (_event, ctx) => {
    const store = new NotificationStore({ path: resolve(ctx.cwd, process.env.PI_NOTIFY_DB!),
      sessionId: ctx.sessionManager.getSessionId() });
    try {
      const first = store.add({ source: 'Offline test', message: 'First result' });
      const second = store.add({ source: 'Offline test', message: 'Unseen result' });
      const other = store.forSession('wildcard-other');
      const otherEvent = other.add({ source: 'Offline test', message: 'Keep other session active' });
      const batch = process.env.PI_NOTIFY_DISMISS === 'batch';
      const params = batch ? { ids: ['*', first.id, '*'] } : { id: '*' };
      const response = await dismissTool.execute('offline-wildcard', params, undefined, undefined, ctx);
      const repeated = await dismissTool.execute('offline-wildcard-repeat', params, undefined, undefined, ctx);
      const cleared = store.snapshot().active.length;
      const later = store.add({ source: 'Offline test', message: 'Later arrival' });
      writeFileSync(process.env.PI_NOTIFY_WILDCARD_RESULT!, JSON.stringify({
        response: JSON.parse(response.content[0].text), repeated: JSON.parse(repeated.content[0].text),
        cleared, historyRetained: [first, second].every(n => store.history().some(h => h.id === n.id && h.dismissedAt)),
        otherSessionPreserved: other.snapshot().active.some(n => n.id === otherEvent.id),
        laterArrivalPreserved: store.snapshot().active.some(n => n.id === later.id),
      }));
    } finally { store.close(); }
  });
}
