import { createServer } from 'node:http';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Journal } from './journal.mjs';
import { SubscriptionRegistry } from './subscriptions.mjs';
import { RevisionTracker } from './dedupe.mjs';
import { createHubServer } from './server.mjs';
import { createHttpSender } from './sender.mjs';
import { deliverAll } from './dispatcher.mjs';
import { loadPolicy } from './policy.mjs';

const configPath = fileURLToPath(new URL('../deployment.json', import.meta.url));
const demo = process.argv.includes('--demo');
const portArg = process.argv.find(a => a.startsWith('--port='));
const port = portArg ? Number(portArg.slice(7)) : demo ? 0 : 3000;
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid port');
loadPolicy(configPath);
const journal = new Journal(fileURLToPath(new URL('../events.sqlite', import.meta.url)));
const registry = new SubscriptionRegistry();
let receiver;
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const close = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
const hub = createHubServer({ registry, tracker: new RevisionTracker(), journal, now: Date.now, configPath });
try {
  let receiverUrl = process.argv.find(a => a.startsWith('--receiver='))?.slice(11);
  if (demo) {
    receiver = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const event = JSON.parse(Buffer.concat(chunks).toString());
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ received: event.id }));
    });
    await listen(receiver);
    receiverUrl = `http://127.0.0.1:${receiver.address().port}/webhook`;
  }
  if (receiverUrl) registry.upsert({ id: 'local-receiver', url: receiverUrl, patterns: ['**'], expiresAt: Date.now() + 86400000 });
  await new Promise((resolve, reject) => {
    hub.once('error', reject);
    hub.listen(port, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${hub.address().port}`;
  console.log(`Hub: ${url} (policy: ${configPath})`);
  if (demo) {
    const event = { id: `demo-${crypto.randomUUID()}`, topic: 'demo.created', revision: 0, payload: { hello: 'local' } };
    const response = await fetch(`${url}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) });
    if (response.status !== 202) throw new Error(`Hub HTTP ${response.status}`);
    const { deliveries } = await response.json();
    const send = createHttpSender({ fetchImpl: fetch, loadCurrentPolicy: () => loadPolicy(configPath), wait });
    const results = await deliverAll(deliveries, send, { concurrency: 2 });
    console.log(JSON.stringify({ deliveries: deliveries.length, results }));
    if (results.some(r => !r.ok)) throw new Error('Demo delivery failed');
  } else {
    console.log('POST /events to journal and route; GET /events to inspect. Ctrl-C to stop.');
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  }
} finally {
  if (hub.listening) await close(hub);
  if (receiver?.listening) await close(receiver);
  journal.close();
}
