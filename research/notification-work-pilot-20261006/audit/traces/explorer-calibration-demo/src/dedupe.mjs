export class RevisionTracker {
  #producers = new Map();
  accept(producer, id, revision) {
    if (typeof producer !== 'string' || !producer.trim() || typeof id !== 'string' || !id.trim() || !Number.isInteger(revision) || revision < 0) throw new TypeError('Invalid revision identity');
    let entries = this.#producers.get(producer);
    if (!entries) this.#producers.set(producer, entries = new Map());
    if (entries.has(id) && entries.get(id) >= revision) return false;
    entries.set(id, revision);
    return true;
  }
}
