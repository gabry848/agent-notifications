import { Type } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { NotificationStore, injectSnapshot } from './store.mjs';
import { startNotificationServer } from './http.mjs';

export default function notifications(pi: ExtensionAPI) {
  let database: NotificationStore | undefined;
  let store: NotificationStore | undefined;
  let server: Awaited<ReturnType<typeof startNotificationServer>> | undefined;
  let latest: ReturnType<NotificationStore['snapshot']> | undefined;
  let attempt = 0;
  const contextEnabled = process.env.PI_NOTIFY_CONTEXT !== '0';
  const trace = (type: string, data: object = {}) => {
    if (process.env.PI_NOTIFY_TRACE) appendFileSync(process.env.PI_NOTIFY_TRACE,
      JSON.stringify({ time: new Date().toISOString(), monoMs: Number(process.hrtime.bigint()) / 1e6, type, ...data }) + '\n');
  };
  const promptPath = process.env.PI_NOTIFY_PROMPT ?? fileURLToPath(new URL('../prompts/v2.txt', import.meta.url));
  const instructions = readFileSync(promptPath, 'utf8').trim();

  pi.on('session_start', async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    if (!database) database = new NotificationStore({
      path: resolve(ctx.cwd, process.env.PI_NOTIFY_DB ?? '.pi/notifications.sqlite'), sessionId,
    });
    store = database.forSession(sessionId);
    latest = undefined;
    attempt = 0;
    if (!server) {
      server = await startNotificationServer({
        store: target => target === undefined ? store! : database!.forSession(target, { create: false }),
        port: Number(process.env.PI_NOTIFY_PORT ?? 0),
        onReceive: notification => trace('notification_received', { notification,
          lastContextCall: database!.forSession(notification.sessionId, { create: false }).call }),
        release: process.env.PI_NOTIFY_LAB === '1' ? data => pi.events.emit('notification-lab:release', data) : undefined,
      });
    }
    const ready = { url: server.url, sessionId, databasePath: database.databasePath };
    trace('session_selected', { ...ready, reason: event.reason, call: store.call });
    trace('server_ready', ready);
    if (process.env.PI_NOTIFY_READY) writeFileSync(process.env.PI_NOTIFY_READY, JSON.stringify(ready));
  });
  pi.on('session_shutdown', async () => {
    try { await server?.close(); }
    finally { server = undefined; database?.close(); database = undefined; store = undefined; }
  });
  pi.on('before_agent_start', event => contextEnabled ? ({ systemPrompt: event.systemPrompt.includes(instructions)
    ? event.systemPrompt : event.systemPrompt + '\n\n' + instructions }) : undefined);
  pi.on('context', event => {
    if (!contextEnabled) return;
    if (!store) throw new Error('Notification database not initialized');
    const started = Number(process.hrtime.bigint()) / 1e6;
    latest = store.snapshot();
    attempt = 0;
    const position = process.env.PI_NOTIFY_POSITION ?? 'tail';
    const messages = injectSnapshot(event.messages, latest, { position });
    trace('context_snapshot', { ...latest, position, durationMs: Number(process.hrtime.bigint()) / 1e6 - started });
    return { messages };
  });
  pi.on('before_provider_request', event => {
    attempt++;
    // Provider payloads contain prompts and tools, not assembled auth headers.
    if (process.env.PI_NOTIFY_PROVIDER_TRACE) appendFileSync(process.env.PI_NOTIFY_PROVIDER_TRACE,
      JSON.stringify({ type: 'provider_request', time: new Date().toISOString(), call: latest?.call,
        attempt, payload: event.payload }) + '\n');
    trace('provider_request', { call: latest?.call, attempt });
  });
  pi.on('after_provider_response', event => trace('provider_response', { call: latest?.call, status: event.status }));

  if (process.env.PI_NOTIFY_DISMISS === 'batch') pi.registerTool({
    name: 'notifications_dismiss', label: 'Dismiss notifications',
    description: 'Remove one or more notification IDs together from the dynamic context; retain them in history.',
    parameters: Type.Object({ ids: Type.Array(Type.String(), { minItems: 1, maxItems: 200 }) }),
    async execute(_id, params) {
      if (!store) throw new Error('Notification database not initialized');
      const results = params.ids.map(id => {
        const result = store!.dismiss(id); trace('notification_dismissed', result); return result;
      });
      return { content: [{ type: 'text', text: JSON.stringify({ results }) }], details: { results } };
    },
  });
  else pi.registerTool({
    name: 'notifications_dismiss', label: 'Dismiss notification',
    description: 'Remove a notification from the dynamic context; retain it in history.',
    parameters: Type.Object({ id: Type.String() }),
    async execute(_id, params) {
      if (!store) throw new Error('Notification database not initialized');
      const result = store.dismiss(params.id);
      trace('notification_dismissed', result);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
    },
  });
  pi.registerTool({
    name: 'notifications_history', label: 'Notification history',
    description: 'Retrieve previously received notifications, including dismissed entries. since is a duration like 2h.',
    parameters: Type.Object({ since: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })) }),
    async execute(_id, params) {
      if (!store) throw new Error('Notification database not initialized');
      const notifications = store.history(params);
      trace('notification_history', { notifications });
      return { content: [{ type: 'text', text: JSON.stringify(notifications) }], details: { notifications } };
    },
  });
}
