import { normalizeEvent } from './envelope.mjs';
export function routeEvent(input, registry, tracker, now) {
  const event = normalizeEvent(input);
  if (!tracker.accept('webhook', event.id, event.revision)) return [];
  return registry.matching(event.topic, now).map(s => ({ subscriptionId: s.id, url: s.url, event: normalizeEvent(event) }));
}
