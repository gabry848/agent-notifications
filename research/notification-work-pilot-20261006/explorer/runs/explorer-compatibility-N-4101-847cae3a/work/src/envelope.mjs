export function normalizeEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.id !== 'string' || !input.id.trim() ||
      typeof input.topic !== 'string' || !input.topic.trim() ||
      !Number.isInteger(input.revision) || input.revision < 0 ||
      !input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    throw new TypeError('Invalid event');
  }
  return { id: input.id, topic: input.topic, revision: input.revision, payload: structuredClone(input.payload) };
}
