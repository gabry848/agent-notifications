import { createServer } from 'node:http';
import { normalizeEvent } from './envelope.mjs';
import { routeEvent } from './router.mjs';
import { loadPolicy } from './policy.mjs';

export function createHubServer({ registry, tracker, journal, now = Date.now, configPath }) {
  return createServer(async (req, res) => {
    const reply = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    try {
      const limit = configPath ? loadPolicy(configPath).maxPayloadBytes : 65536;
      if (req.method === 'GET' && req.url === '/events') return reply(200, { events: journal.all() });
      if (req.method !== 'POST' || req.url !== '/events') return reply(404, { error: 'Not found' });
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) {
          reply(413, { error: 'Payload too large' });
          req.resume();
          return;
        }
        chunks.push(chunk);
      }
      let event;
      try { event = normalizeEvent(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { return reply(400, { error: 'Invalid JSON event' }); }
      const stored = journal.record(event);
      const deliveries = stored ? routeEvent(event, registry, tracker, now()) : [];
      reply(202, { deliveries });
    } catch { if (!res.headersSent) reply(500, { error: 'Internal server error' }); }
  });
}
