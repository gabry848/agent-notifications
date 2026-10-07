import { matchesTopic, validPattern } from './topics.mjs';

export class SubscriptionRegistry {
  #entries = new Map();
  upsert(value) {
    if (!value || typeof value.id !== 'string' || !value.id.trim() ||
        typeof value.url !== 'string' || !Array.isArray(value.patterns) ||
        !value.patterns.length || !value.patterns.every(validPattern) || !Number.isFinite(value.expiresAt)) {
      throw new TypeError('Invalid subscription');
    }
    let url;
    try { url = new URL(value.url); } catch { throw new TypeError('Invalid subscription URL'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('Invalid subscription URL');
    this.#entries.set(value.id, { id: value.id, url: value.url, patterns: [...value.patterns], expiresAt: value.expiresAt });
  }
  remove(id) { return this.#entries.delete(id); }
  matching(topic, now) {
    return [...this.#entries.values()]
      .filter(s => s.expiresAt > now && s.patterns.some(p => matchesTopic(p, topic)))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      .map(s => structuredClone(s));
  }
}
