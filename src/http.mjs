import { createServer } from 'node:http';

export async function startNotificationServer({ store, port = 0, onReceive = () => {}, release }) {
  const server = createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST' || !['/notify', ...(release ? ['/lab/release'] : [])].includes(req.url)) {
      req.resume(); return reply(404, { error: 'Not found' });
    }
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 16384) {
          reply(413, { error: 'Body too large' }); req.destroy(); return;
        }
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Object required');
      if (req.url === '/lab/release') {
        release(input); return reply(200, { released: true });
      }
      if (input.sessionId !== undefined && (typeof input.sessionId !== 'string' || !input.sessionId.trim() || input.sessionId.length > 128)) {
        throw new Error('Invalid sessionId');
      }
      const selected = typeof store === 'function' ? store(input.sessionId) : store;
      if (input.sessionId !== undefined && selected.sessionId !== input.sessionId) throw new Error('Unknown notification session');
      const notification = selected.add(input);
      onReceive(notification);
      reply(201, notification);
    } catch (error) {
      reply(400, { error: error.message });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeIdleConnections();
  }) };
}
