export class BoundedQueue {
  #items = [];
  #capacity;
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new TypeError('Invalid capacity');
    this.#capacity = capacity;
  }
  push(item) {
    if (this.size >= this.#capacity) return false;
    this.#items.push(item);
    return true;
  }
  shift() { return this.#items.shift(); }
  get size() { return this.#items.length; }
}
